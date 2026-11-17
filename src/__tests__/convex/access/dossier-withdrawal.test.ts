import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const withdrawDossier = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; reason: string },
    { withdrawn: boolean }
>("admin:withdrawDossier");
const listAuditEvents = makeFunctionReference<
    "query",
    { targetType: string; targetId: string },
    Array<unknown>
>("audit:listByTarget");

const withdrawalReason = "Dossier finished; the analyst needs another launch";

type RunOverride = Partial<{
    reservationStatus: "consumed" | "restored";
    lifecycleState: string;
    executionStatus: string;
    executionGeneration: number;
    nextEventSequence: number;
}>;

type WithdrawalFixture = {
    admin: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
    owner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
    runId: Id<"researchRuns">;
    ownerVisitorId: Id<"visitors">;
};

async function seedWithdrawalFixture(
    t: ReturnType<typeof convexTest>,
    options: { ownerAnalysesReserved?: number; run?: RunOverride } = {},
): Promise<WithdrawalFixture> {
    const ids = await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const adminUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const ownerInvitationId = await ctx.db.insert("invitations", {
            slotKey: "withdrawal-test-analyst",
            role: "analyst",
            codeDigest: "withdrawal-test-analyst-digest",
            status: "claimed",
            createdAt: 1,
        });
        const adminInvitationId = await ctx.db.insert("invitations", {
            slotKey: "withdrawal-test-admin",
            role: "admin",
            codeDigest: "withdrawal-test-admin-digest",
            status: "claimed",
            createdAt: 1,
        });
        const ownerVisitorId = await ctx.db.insert("visitors", {
            authUserId: ownerUserId,
            invitationId: ownerInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: options.ownerAnalysesReserved ?? 1,
            admittedAt: 1,
        });
        await ctx.db.patch(ownerInvitationId, {
            claimedByVisitorId: ownerVisitorId,
        });
        const adminVisitorId = await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId: adminInvitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(adminInvitationId, {
            claimedByVisitorId: adminVisitorId,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId,
            reservationKey: "withdraw-fixture",
            reservationStatus: "consumed",
            lifecycleState: "completed",
            executionStatus: "completed",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
            ...options.run,
        });
        return {
            ownerUserId,
            adminUserId,
            ownerVisitorId,
            adminVisitorId,
            runId,
        };
    });
    return {
        admin: t.withIdentity({ subject: `${ids.adminUserId}|admin-session` }),
        owner: t.withIdentity({ subject: `${ids.ownerUserId}|owner-session` }),
        runId: ids.runId,
        ownerVisitorId: ids.ownerVisitorId,
    };
}

test("an administrator withdraws a completed dossier and releases exactly one seat with an audit record", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWithdrawalFixture(t);

    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: withdrawalReason,
        }),
    ).resolves.toEqual({ withdrawn: true });

    await expect(
        t.run((ctx) => ctx.db.get(f.ownerVisitorId)),
    ).resolves.toMatchObject({ analysesReserved: 0 });
    const run = await t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "completed",
        executionStatus: "completed",
    });
    expect(run?.withdrawnAt).toEqual(expect.any(Number));
    await expect(
        t.query(listAuditEvents, {
            targetType: "research_run",
            targetId: f.runId,
        }),
    ).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                action: "dossier_withdrawn",
                reason: withdrawalReason,
            }),
        ]),
    );

    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: "A repeated withdrawal must not release another seat",
        }),
    ).resolves.toEqual({ withdrawn: false });
    await expect(
        t.run((ctx) => ctx.db.get(f.ownerVisitorId)),
    ).resolves.toMatchObject({ analysesReserved: 0 });
});

test("withdrawal stops a running execution through the shared cancellation owner before release", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWithdrawalFixture(t, {
        run: {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 2,
            nextEventSequence: 3,
        },
    });

    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: withdrawalReason,
        }),
    ).resolves.toEqual({ withdrawn: true });

    const run = await t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        executionStatus: "cancelled",
        withdrawnAt: expect.any(Number),
    });
    expect(run?.executionGeneration).toBe(3);
    await expect(
        t.run((ctx) =>
            ctx.db
                .query("runEvents")
                .withIndex("by_run_and_sequence", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                type: "run_cancelled",
                sequence: 4,
                executionStatus: "cancelled",
            }),
        ]),
    );
    await expect(
        t.run((ctx) => ctx.db.get(f.ownerVisitorId)),
    ).resolves.toMatchObject({ analysesReserved: 0 });
});

test("only an active administrator may withdraw a dossier", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWithdrawalFixture(t);

    await expect(
        t.mutation(withdrawDossier, {
            runId: f.runId,
            reason: "Calls without identity must not withdraw dossiers",
        }),
    ).rejects.toThrow("Not authenticated");
    await expect(
        f.owner.mutation(withdrawDossier, {
            runId: f.runId,
            reason: "An analyst cannot withdraw a dossier",
        }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        t.run((ctx) => ctx.db.get(f.ownerVisitorId)),
    ).resolves.toMatchObject({ analysesReserved: 1 });
    const reservedRun = await t.run((ctx) => ctx.db.get(f.runId));
    expect(reservedRun?.withdrawnAt).toBeUndefined();
});

test("withdrawal is limited to consumed research dossiers with a specific reason", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWithdrawalFixture(t);

    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: "too short",
        }),
    ).rejects.toThrow("Dossier withdrawal requires a specific reason");
    const missingRunId = await t.run(async (ctx) => {
        const disposable = await ctx.db.insert("researchRuns", {
            purpose: "evaluation",
            lifecycleState: "draft",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        });
        await ctx.db.delete(disposable);
        return disposable;
    });
    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: missingRunId,
            reason: withdrawalReason,
        }),
    ).rejects.toThrow("Research run not found");

    const technicalRunId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            purpose: "evaluation",
            reservationStatus: "consumed",
            lifecycleState: "completed",
            executionStatus: "completed",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        }),
    );
    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: technicalRunId,
            reason: "Technical runs hold no human seat",
        }),
    ).rejects.toThrow("Only a consumed research dossier");

    const ownerlessRunId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: undefined,
            reservationStatus: "consumed",
            lifecycleState: "completed",
            executionStatus: "completed",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        }),
    );
    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: ownerlessRunId,
            reason: "I need an ownerless run rejection path",
        }),
    ).rejects.toThrow("Only a consumed research dossier");

    await t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationStatus: "restored" }),
    );
    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: "A restored reservation is already returned",
        }),
    ).rejects.toThrow("Only a consumed research dossier");

    await t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationStatus: "consumed" }),
    );
    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: withdrawalReason,
        }),
    ).resolves.toEqual({ withdrawn: true });
});

test("the release refuses an owner whose counter cannot cover the reservation", async () => {
    const t = convexTest(schema, modules);
    const f = await seedWithdrawalFixture(t, { ownerAnalysesReserved: 0 });

    await expect(
        f.admin.mutation(withdrawDossier, {
            runId: f.runId,
            reason: withdrawalReason,
        }),
    ).rejects.toThrow("Reservation owner is inconsistent");
    const blockedRun = await t.run((ctx) => ctx.db.get(f.runId));
    expect(blockedRun?.withdrawnAt).toBeUndefined();
});
