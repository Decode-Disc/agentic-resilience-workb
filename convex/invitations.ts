import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    action,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import { digestInvitationCode } from "./domain/invitationCodes";
import { visitorRoleValidator } from "./domain/validators";
import { rateLimiter } from "./rateLimiter";
import {
    BROWSER_TEST_SLOT,
    isBrowserTestSlot,
    isE2EWorkerSlot,
    isLoopbackDeployment,
    localBrowserFixturesEnabled,
} from "./runWorkspace";

const seedEntryValidator = v.object({
    slotKey: v.string(),
    role: visitorRoleValidator,
    codeDigest: v.string(),
});

type ConfiguredInvitation = {
    slotKey: string;
    role: "admin" | "analyst";
    code: string;
};

const invitationCodePattern = /^\d{4}$/;

function parseConfiguredInvitations(
    value: string,
): Array<ConfiguredInvitation> {
    const parsed: unknown = JSON.parse(value);
    if (
        !Array.isArray(parsed) ||
        !parsed.every(
            (entry): entry is ConfiguredInvitation =>
                typeof entry === "object" &&
                entry !== null &&
                "slotKey" in entry &&
                typeof entry.slotKey === "string" &&
                "role" in entry &&
                (entry.role === "admin" || entry.role === "analyst") &&
                "code" in entry &&
                typeof entry.code === "string" &&
                invitationCodePattern.test(entry.code),
        )
    ) {
        throw new Error("INVITATION_SEED_CONFIG is invalid");
    }
    return parsed;
}

export const seedForSetup = internalMutation({
    args: { invitations: v.array(seedEntryValidator) },
    returns: v.object({ created: v.number(), total: v.number() }),
    handler: async (ctx, args) => {
        if (args.invitations.length !== 5) {
            throw new Error("Invitation setup must contain exactly five slots");
        }
        if (
            args.invitations.filter((invitation) => invitation.role === "admin")
                .length !== 1
        ) {
            throw new Error(
                "Invitation setup must contain exactly one admin slot",
            );
        }
        const slotKeys = new Set(
            args.invitations.map((invitation) => invitation.slotKey),
        );
        const digests = new Set(
            args.invitations.map((invitation) => invitation.codeDigest),
        );
        if (slotKeys.size !== 5 || digests.size !== 5) {
            throw new Error("Invitation slots and code digests must be unique");
        }

        let created = 0;
        const now = Date.now();
        for (const invitation of args.invitations) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_slot_key", (query) =>
                    query.eq("slotKey", invitation.slotKey),
                )
                .unique();
            if (existing) {
                if (existing.role !== invitation.role) {
                    throw new Error(
                        `Invitation slot ${invitation.slotKey} already has different configuration`,
                    );
                }
                if (existing.codeDigest !== invitation.codeDigest) {
                    const digestOwner = await ctx.db
                        .query("invitations")
                        .withIndex("by_code_digest", (query) =>
                            query.eq("codeDigest", invitation.codeDigest),
                        )
                        .unique();
                    if (digestOwner && digestOwner._id !== existing._id) {
                        throw new Error(
                            `Invitation slot ${invitation.slotKey} uses a code assigned to another slot`,
                        );
                    }
                    if (existing.claimedByVisitorId) {
                        const visitor = await ctx.db.get(
                            existing.claimedByVisitorId,
                        );
                        if (visitor?.status === "active") {
                            await ctx.db.patch(visitor._id, {
                                status: "revoked",
                                revokedAt: now,
                            });
                            await ctx.db.insert("auditEvents", {
                                actor: { type: "system" },
                                action: "invitation_revoked",
                                targetType: "visitor",
                                targetId: visitor._id,
                                reason: "Configured access code rotation",
                                occurredAt: now,
                            });
                        }
                    }
                    await ctx.db.patch(existing._id, {
                        codeDigest: invitation.codeDigest,
                    });
                    await ctx.db.insert("auditEvents", {
                        actor: { type: "system" },
                        action: "invitation_code_rotated",
                        targetType: "invitation",
                        targetId: existing._id,
                        reason: "Configured access code rotation",
                        occurredAt: now,
                    });
                }
                continue;
            }
            const invitationId = await ctx.db.insert("invitations", {
                ...invitation,
                status: "available",
                createdAt: now,
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "system" },
                action: "invitation_seeded",
                targetType: "invitation",
                targetId: invitationId,
                occurredAt: now,
            });
            created += 1;
        }

        const total = (await ctx.db.query("invitations").collect()).length;
        if (total !== 5) {
            throw new Error("Invitation setup must leave exactly five slots");
        }
        return { created, total };
    },
});

export const listForSetup = internalQuery({
    args: {},
    handler: async (ctx) => ctx.db.query("invitations").collect(),
});

export const bootstrapConfigured = action({
    args: {},
    returns: v.object({ created: v.number(), total: v.number() }),
    handler: async (ctx): Promise<{ created: number; total: number }> => {
        const pepper = process.env.INVITATION_CODE_PEPPER;
        const config = process.env.INVITATION_SEED_CONFIG;
        if (!pepper || !config) {
            throw new Error("Invitation bootstrap is not configured");
        }
        const configuredInvitations = parseConfiguredInvitations(config);
        const invitations = await Promise.all(
            configuredInvitations.map(async (invitation) => ({
                slotKey: invitation.slotKey,
                role: invitation.role,
                codeDigest: await digestInvitationCode(invitation.code, pepper),
            })),
        );
        return ctx.runMutation(internal.invitations.seedForSetup, {
            invitations,
        });
    },
});

export const claim = action({
    args: { code: v.string() },
    returns: v.object({
        visitorId: v.id("visitors"),
        role: visitorRoleValidator,
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ visitorId: Id<"visitors">; role: "admin" | "analyst" }> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        if (!invitationCodePattern.test(args.code)) {
            throw new Error("Access code must contain exactly four digits");
        }
        const pepper = process.env.INVITATION_CODE_PEPPER;
        if (!pepper) {
            throw new Error("Access code verification is not configured");
        }
        await ctx.runMutation(internal.invitations.consumeClaimAttempt, {
            authUserId,
        });
        const codeDigest = await digestInvitationCode(args.code, pepper);
        return ctx.runMutation(internal.invitations.claimDigest, {
            authUserId,
            codeDigest,
        });
    },
});

export const consumeClaimAttempt = internalMutation({
    args: { authUserId: v.id("users") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const globalStatus = await rateLimiter.limit(
            ctx,
            "invitationClaimGlobal",
        );
        if (!globalStatus.ok) {
            throw new Error("Too many access code attempts. Try again later.");
        }

        const perUserStatus = await rateLimiter.limit(
            ctx,
            "invitationClaimPerUser",
            { key: `auth:${args.authUserId}` },
        );
        if (!perUserStatus.ok) {
            throw new Error("Too many access code attempts. Try again later.");
        }
        return null;
    },
});

export const claimDigest = internalMutation({
    args: { authUserId: v.id("users"), codeDigest: v.string() },
    returns: v.object({
        visitorId: v.id("visitors"),
        role: visitorRoleValidator,
    }),
    handler: async (ctx, args) => {
        const existingVisitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", args.authUserId),
            )
            .unique();
        if (existingVisitor) {
            const existingInvitation = await ctx.db.get(
                existingVisitor.invitationId,
            );
            if (
                (isBrowserTestSlot(existingInvitation?.slotKey) ||
                    isE2EWorkerSlot(existingInvitation?.slotKey)) &&
                !localBrowserFixturesEnabled()
            )
                throw new Error("Access code is not available");
            if (
                existingInvitation?.codeDigest === args.codeDigest &&
                existingVisitor.status === "active"
            ) {
                return {
                    visitorId: existingVisitor._id,
                    role: existingVisitor.role,
                };
            }
            throw new Error(
                "Authenticated user is already linked to a visitor",
            );
        }

        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_code_digest", (query) =>
                query.eq("codeDigest", args.codeDigest),
            )
            .unique();
        if (
            !invitation ||
            ((invitation.slotKey === BROWSER_TEST_SLOT ||
                isE2EWorkerSlot(invitation.slotKey)) &&
                !localBrowserFixturesEnabled())
        ) {
            throw new Error("Access code is not available");
        }

        const now = Date.now();
        if (invitation.status === "claimed") {
            if (!invitation.claimedByVisitorId) {
                throw new Error("Access code is not available");
            }
            const visitor = await ctx.db.get(invitation.claimedByVisitorId);
            if (!visitor) {
                throw new Error("Access code is not available");
            }
            await ctx.db.patch(visitor._id, {
                authUserId: args.authUserId,
                status: "active",
                revokedAt: undefined,
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "visitor", visitorId: visitor._id },
                action: "visitor_session_rebound",
                targetType: "visitor",
                targetId: visitor._id,
                occurredAt: now,
            });
            return {
                visitorId: visitor._id,
                role: visitor.role,
            };
        }

        const visitorId = await ctx.db.insert("visitors", {
            authUserId: args.authUserId,
            invitationId: invitation._id,
            role: invitation.role,
            status: "active",
            analysesReserved: 0,
            admittedAt: now,
        });
        await ctx.db.patch(invitation._id, {
            status: "claimed",
            claimedByVisitorId: visitorId,
            claimedAt: now,
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId },
            action: "invitation_claimed",
            targetType: "invitation",
            targetId: invitation._id,
            occurredAt: now,
        });
        return { visitorId, role: invitation.role };
    },
});

export const rotateAdminFromConfig = internalAction({
    args: {},
    returns: v.null(),
    handler: async (ctx): Promise<null> => {
        const pepper = process.env.INVITATION_CODE_PEPPER;
        const recoveryCode = process.env.INVITATION_ADMIN_RECOVERY_CODE;
        if (
            !pepper ||
            !recoveryCode ||
            !invitationCodePattern.test(recoveryCode)
        ) {
            throw new Error("Admin access code recovery is not configured");
        }
        const codeDigest = await digestInvitationCode(recoveryCode, pepper);
        await ctx.runMutation(internal.invitations.rotateAdminDigest, {
            codeDigest,
        });
        return null;
    },
});

export const rotateAdminDigest = internalMutation({
    args: { codeDigest: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (query) => query.eq("slotKey", "admin"))
            .unique();
        if (invitation?.role !== "admin") {
            throw new Error("Admin invitation slot not found");
        }
        const digestOwner = await ctx.db
            .query("invitations")
            .withIndex("by_code_digest", (query) =>
                query.eq("codeDigest", args.codeDigest),
            )
            .unique();
        if (digestOwner && digestOwner._id !== invitation._id) {
            throw new Error("Recovery code is already assigned");
        }

        const now = Date.now();
        if (invitation.claimedByVisitorId) {
            await ctx.db.patch(invitation.claimedByVisitorId, {
                status: "revoked",
                revokedAt: now,
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "system" },
                action: "invitation_revoked",
                targetType: "visitor",
                targetId: invitation.claimedByVisitorId,
                reason: "Break-glass admin invitation rotation",
                occurredAt: now,
            });
        }
        await ctx.db.patch(
            invitation._id,
            invitation.claimedByVisitorId
                ? {
                      codeDigest: args.codeDigest,
                      status: "claimed",
                      revokedAt: undefined,
                  }
                : {
                      codeDigest: args.codeDigest,
                      status: "available",
                      claimedByVisitorId: undefined,
                      claimedAt: undefined,
                      revokedAt: undefined,
                  },
        );
        await ctx.db.insert("auditEvents", {
            actor: { type: "system" },
            action: "invitation_reissued",
            targetType: "invitation",
            targetId: invitation._id,
            reason: "Break-glass admin invitation rotation",
            occurredAt: now,
        });
        return null;
    },
});

export const applyE2EWorkerSlots = internalMutation({
    args: {
        slots: v.array(seedEntryValidator),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (!isLoopbackDeployment()) {
            throw new Error("Local deployment required");
        }
        if (args.slots.length > 0 && !localBrowserFixturesEnabled()) {
            throw new Error("Local browser fixtures are disabled");
        }
        const desiredKeys = new Set(args.slots.map((entry) => entry.slotKey));
        for (const entry of args.slots) {
            if (!isE2EWorkerSlot(entry.slotKey)) {
                throw new Error(`Invalid E2E worker slot: ${entry.slotKey}`);
            }
            const expectedRole = entry.slotKey.startsWith("admin-")
                ? "admin"
                : "analyst";
            if (entry.role !== expectedRole) {
                throw new Error(`Role mismatch for E2E worker slot: ${entry.slotKey}`);
            }
        }

        const now = Date.now();
        const existingInvitations = await ctx.db.query("invitations").collect();
        for (const existing of existingInvitations) {
            if (!isE2EWorkerSlot(existing.slotKey)) continue;
            if (!desiredKeys.has(existing.slotKey)) {
                if (existing.claimedByVisitorId) {
                    const visitor = await ctx.db.get(existing.claimedByVisitorId);
                    if (visitor) {
                        const contexts = await ctx.db
                            .query("browserTestContexts")
                            .withIndex("by_auth_user_id_and_status", (q) =>
                                q
                                    .eq("authUserId", visitor.authUserId)
                                    .eq("status", "active"),
                            )
                            .collect();
                        for (const context of contexts) {
                            await ctx.db.patch(context._id, {
                                status: "closed",
                                closedAt: now,
                            });
                        }
                        if (visitor.status === "active") {
                            await ctx.db.patch(visitor._id, {
                                status: "revoked",
                                revokedAt: now,
                            });
                        }
                    }
                }
                await ctx.db.delete(existing._id);
            }
        }

        for (const entry of args.slots) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_slot_key", (q) => q.eq("slotKey", entry.slotKey))
                .unique();
            if (existing) {
                if (existing.codeDigest !== entry.codeDigest) {
                    if (existing.claimedByVisitorId) {
                        const visitor = await ctx.db.get(
                            existing.claimedByVisitorId,
                        );
                        if (visitor?.status === "active") {
                            await ctx.db.patch(visitor._id, {
                                status: "revoked",
                                revokedAt: now,
                            });
                        }
                    }
                    await ctx.db.patch(existing._id, {
                        codeDigest: entry.codeDigest,
                        status: "available",
                        claimedByVisitorId: undefined,
                        claimedAt: undefined,
                    });
                }
                continue;
            }
            await ctx.db.insert("invitations", {
                slotKey: entry.slotKey,
                role: entry.role,
                codeDigest: entry.codeDigest,
                status: "available",
                createdAt: now,
            });
        }
        return null;
    },
});

export const syncE2EWorkerSlots = internalAction({
    args: {
        slots: v.array(
            v.object({
                slotKey: v.string(),
                role: visitorRoleValidator,
                code: v.string(),
            }),
        ),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        if (args.slots.length === 0) {
            await ctx.runMutation(internal.invitations.applyE2EWorkerSlots, {
                slots: [],
            });
            if (isLoopbackDeployment() && localBrowserFixturesEnabled()) {
                await rateLimiter.reset(ctx, "invitationClaimGlobal");
            }
            return null;
        }
        if (!isLoopbackDeployment() || !localBrowserFixturesEnabled()) {
            throw new Error("Local browser fixtures are disabled");
        }
        const pepper = process.env.INVITATION_CODE_PEPPER;
        if (!pepper) {
            throw new Error("Invitation bootstrap is not configured");
        }
        const hashed = await Promise.all(
            args.slots.map(async (entry) => {
                if (!invitationCodePattern.test(entry.code)) {
                    throw new Error("Worker code must contain four digits");
                }
                return {
                    slotKey: entry.slotKey,
                    role: entry.role,
                    codeDigest: await digestInvitationCode(entry.code, pepper),
                };
            }),
        );
        await ctx.runMutation(internal.invitations.applyE2EWorkerSlots, {
            slots: hashed,
        });
        await rateLimiter.reset(ctx, "invitationClaimGlobal");
        return null;
    },
});
