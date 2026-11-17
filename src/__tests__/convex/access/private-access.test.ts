import type { Id } from "@convex/_generated/dataModel";
import { digestInvitationCode } from "@convex/domain/invitationCodes";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

type SeedEntry = {
    slotKey: string;
    role: "admin" | "analyst";
    codeDigest: string;
};

const seedInvitations = makeFunctionReference<
    "mutation",
    { invitations: Array<SeedEntry> },
    { created: number; total: number }
>("invitations:seedForSetup");
const bootstrapConfiguredInvitations = makeFunctionReference<
    "action",
    Record<string, never>,
    { created: number; total: number }
>("invitations:bootstrapConfigured");
const listInvitations = makeFunctionReference<
    "query",
    Record<string, never>,
    Array<unknown>
>("invitations:listForSetup");
const claimInvitation = makeFunctionReference<
    "action",
    { code: string },
    { visitorId: string; role: "admin" | "analyst" }
>("invitations:claim");
const currentVisitor = makeFunctionReference<
    "query",
    Record<string, never>,
    unknown
>("visitors:current");
const confirmAndStart = makeFunctionReference<
    "action",
    {
        preflightId: Id<"companyPreflights">;
        idempotencyKey: string;
        coveragePreset: "balanced";
    },
    { runId: Id<"researchRuns">; remainingAnalyses: number }
>("researchLaunch:confirmAndStart");
const restoreQuota = makeFunctionReference<
    "mutation",
    { runId: string; reason: string },
    { restored: boolean }
>("admin:restoreQuota");
const listAuditEvents = makeFunctionReference<
    "query",
    { targetType: string; targetId: string },
    Array<unknown>
>("audit:listByTarget");
const rotateAdminInvitation = makeFunctionReference<
    "action",
    Record<string, never>,
    null
>("invitations:rotateAdminFromConfig");

const invitationCodes = ["1000", "2000", "3000", "4000", "5000"];
const invitationPepper = "test-only-invitation-pepper";

async function buildInvitationSeed(): Promise<Array<SeedEntry>> {
    const roles = [
        "admin",
        "analyst",
        "analyst",
        "analyst",
        "analyst",
    ] as const;
    return Promise.all(
        invitationCodes.map(async (code, index) => ({
            slotKey: index === 0 ? "admin" : `analyst-${index}`,
            role: roles[index] ?? "analyst",
            codeDigest: await digestInvitationCode(code, invitationPepper),
        })),
    );
}

async function createUnusedReservationFixture(
    t: ReturnType<typeof convexTest>,
    visitorId: Id<"visitors">,
    reservationKey: string,
): Promise<Id<"researchRuns">> {
    return t.run(async (ctx) => {
        const visitor = await ctx.db.get(visitorId);
        if (!visitor) {
            throw new Error("Visitor fixture not found");
        }
        const now = Date.now();
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            reservationKey,
            reservationStatus: "consumed",
            retryCount: 0,
            executionGeneration: 0,
            lifecycleState: "draft",
            executionStatus: "idle",
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        await ctx.db.patch(visitorId, {
            analysesReserved: visitor.analysesReserved + 1,
        });
        return runId;
    });
}

test("setup seeds exactly five invitation slots idempotently", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
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

test("the deployment bootstrap seeds configured invitations without exposing codes", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: "admin", role: "admin", code: "1000" },
        {
            slotKey: "analyst-1",
            role: "analyst",
            code: "2000",
        },
        {
            slotKey: "analyst-2",
            role: "analyst",
            code: "3000",
        },
        {
            slotKey: "analyst-3",
            role: "analyst",
            code: "4000",
        },
        {
            slotKey: "analyst-4",
            role: "analyst",
            code: "5000",
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

test("configured code rotation preserves the visitor and revokes its old session", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: "admin", role: "admin", code: "1000" },
        { slotKey: "analyst-1", role: "analyst", code: "2000" },
        { slotKey: "analyst-2", role: "analyst", code: "3000" },
        { slotKey: "analyst-3", role: "analyst", code: "4000" },
        { slotKey: "analyst-4", role: "analyst", code: "5000" },
    ]);
    await t.action(bootstrapConfiguredInvitations, {});
    const oldUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const oldUser = t.withIdentity({ subject: `${oldUserId}|old-session` });
    const firstAdmission = await oldUser.action(claimInvitation, {
        code: "2000",
    });
    await createUnusedReservationFixture(
        t,
        firstAdmission.visitorId as Id<"visitors">,
        "run-before-configured-rotation",
    );

    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: "admin", role: "admin", code: "1111" },
        { slotKey: "analyst-1", role: "analyst", code: "2222" },
        { slotKey: "analyst-2", role: "analyst", code: "3333" },
        { slotKey: "analyst-3", role: "analyst", code: "4444" },
        { slotKey: "analyst-4", role: "analyst", code: "5555" },
    ]);

    await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual(
        {
            created: 0,
            total: 5,
        },
    );
    await expect(oldUser.query(currentVisitor, {})).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        status: "revoked",
    });

    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|rotated-session` });
    await expect(
        user.action(claimInvitation, { code: "2222" }),
    ).resolves.toEqual(firstAdmission);
    await expect(user.query(currentVisitor, {})).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        authUserId: userId,
        status: "active",
        analysesReserved: 1,
    });
});

test("an access code reconnects its visitor with a new anonymous session", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const firstUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const secondUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const firstUser = t.withIdentity({ subject: `${firstUserId}|session-1` });
    const secondUser = t.withIdentity({ subject: `${secondUserId}|session-2` });

    const firstAdmission = await firstUser.action(claimInvitation, {
        code: invitationCodes[1] ?? "",
    });
    expect(firstAdmission).toMatchObject({
        role: "analyst",
    });
    await expect(firstUser.query(currentVisitor, {})).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        authUserId: firstUserId,
        role: "analyst",
        status: "active",
    });
    const resumedSession = t.withIdentity({
        subject: `${firstUserId}|session-3`,
    });
    await expect(
        resumedSession.query(currentVisitor, {}),
    ).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        authUserId: firstUserId,
        status: "active",
    });

    await expect(
        secondUser.action(claimInvitation, {
            code: invitationCodes[1] ?? "",
        }),
    ).resolves.toEqual(firstAdmission);
    await expect(firstUser.query(currentVisitor, {})).resolves.toBeNull();
    await expect(secondUser.query(currentVisitor, {})).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        authUserId: secondUserId,
        role: "analyst",
        status: "active",
    });
    await expect(
        t.query(listAuditEvents, {
            targetType: "visitor",
            targetId: firstAdmission.visitorId,
        }),
    ).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                action: "visitor_session_rebound",
            }),
        ]),
    );
});

test("access codes reject values outside the four-digit contract", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|session` });

    await expect(
        user.action(claimInvitation, { code: "12345" }),
    ).rejects.toThrow("Access code must contain exactly four digits");
});

test("access codes lock one anonymous session after five failed attempts", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    await t.mutation(seedInvitations, {
        invitations: await buildInvitationSeed(),
    });
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|session` });

    for (const code of ["0101", "0102", "0103", "0104", "0105"]) {
        await expect(user.action(claimInvitation, { code })).rejects.toThrow(
            "Access code is not available",
        );
    }

    await expect(
        user.action(claimInvitation, { code: invitationCodes[1] ?? "" }),
    ).rejects.toThrow("Too many access code attempts");
});

test("an expired preflight cannot consume quota or create a run", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const visitor = t.withIdentity({ subject: `${userId}|session` });
    const admission = await visitor.action(claimInvitation, {
        code: invitationCodes[2] ?? "",
    });
    const preflightId = await t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 1,
        });
        return ctx.db.insert("companyPreflights", {
            ownerVisitorId: admission.visitorId as Id<"visitors">,
            query: "CCCS",
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: 1,
            createdAt: 1,
        });
    });

    await expect(
        visitor.action(confirmAndStart, {
            preflightId,
            idempotencyKey: "expired-preflight",
            coveragePreset: "balanced",
        }),
    ).rejects.toThrow("Company preflight has expired");
    await expect(
        t.run((ctx) => ctx.db.query("researchRuns").collect()),
    ).resolves.toHaveLength(0);
    await expect(visitor.query(currentVisitor, {})).resolves.toMatchObject({
        analysesReserved: 0,
    });
});

test("the invited admin restores an unused reservation with an audited reason", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const adminUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const analystUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const admin = t.withIdentity({ subject: `${adminUserId}|admin-session` });
    const analyst = t.withIdentity({
        subject: `${analystUserId}|analyst-session`,
    });
    await admin.action(claimInvitation, { code: invitationCodes[0] ?? "" });
    const analystAdmission = await analyst.action(claimInvitation, {
        code: invitationCodes[3] ?? "",
    });
    const runId = await createUnusedReservationFixture(
        t,
        analystAdmission.visitorId as Id<"visitors">,
        "restorable-run",
    );

    await expect(
        admin.mutation(restoreQuota, {
            runId,
            reason: "The run was abandoned before workflow launch",
        }),
    ).resolves.toEqual({ restored: true });
    await expect(
        t.query(listAuditEvents, {
            targetType: "research_run",
            targetId: runId,
        }),
    ).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                action: "quota_restored",
                reason: "The run was abandoned before workflow launch",
            }),
        ]),
    );
    await expect(analyst.query(currentVisitor, {})).resolves.toMatchObject({
        analysesReserved: 0,
    });
});

test("admin code rotation preserves the visitor while replacing its session", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_ADMIN_RECOVERY_CODE = "9000";
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const oldAdminUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const newAdminUserId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const oldAdmin = t.withIdentity({
        subject: `${oldAdminUserId}|old-admin-session`,
    });
    const newAdmin = t.withIdentity({
        subject: `${newAdminUserId}|new-admin-session`,
    });
    const firstAdmission = await oldAdmin.action(claimInvitation, {
        code: invitationCodes[0] ?? "",
    });
    await createUnusedReservationFixture(
        t,
        firstAdmission.visitorId as Id<"visitors">,
        "admin-run-before-rotation",
    );

    await t.action(rotateAdminInvitation, {});

    await expect(oldAdmin.query(currentVisitor, {})).resolves.toMatchObject({
        status: "revoked",
    });
    await expect(
        newAdmin.action(claimInvitation, { code: "9000" }),
    ).resolves.toEqual(firstAdmission);
    await expect(newAdmin.query(currentVisitor, {})).resolves.toMatchObject({
        _id: firstAdmission.visitorId,
        authUserId: newAdminUserId,
        role: "admin",
        status: "active",
        analysesReserved: 1,
    });
});
