import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"

import { internal } from "./_generated/api"
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server"
import { digestInvitationCode } from "./domain/invitationCodes"
import { visitorRoleValidator } from "./domain/validators"

const seedEntryValidator = v.object({
  slotKey: v.string(),
  role: visitorRoleValidator,
  codeDigest: v.string(),
})

type ConfiguredInvitation = {
  slotKey: string
  role: "admin" | "analyst"
  code: string
}

function parseConfiguredInvitations(value: string): Array<ConfiguredInvitation> {
  const parsed: unknown = JSON.parse(value)
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
        entry.code.length >= 16,
    )
  ) {
    throw new Error("INVITATION_SEED_CONFIG is invalid")
  }
  return parsed
}

export const seedForSetup = internalMutation({
  args: { invitations: v.array(seedEntryValidator) },
  returns: v.object({ created: v.number(), total: v.number() }),
  handler: async (ctx, args) => {
    if (args.invitations.length !== 5) {
      throw new Error("Invitation setup must contain exactly five slots")
    }
    if (args.invitations.filter((invitation) => invitation.role === "admin").length !== 1) {
      throw new Error("Invitation setup must contain exactly one admin slot")
    }
    const slotKeys = new Set(args.invitations.map((invitation) => invitation.slotKey))
    const digests = new Set(args.invitations.map((invitation) => invitation.codeDigest))
    if (slotKeys.size !== 5 || digests.size !== 5) {
      throw new Error("Invitation slots and code digests must be unique")
    }

    let created = 0
    const now = Date.now()
    for (const invitation of args.invitations) {
      const existing = await ctx.db
        .query("invitations")
        .withIndex("by_slot_key", (query) => query.eq("slotKey", invitation.slotKey))
        .unique()
      if (existing) {
        if (existing.role !== invitation.role || existing.codeDigest !== invitation.codeDigest) {
          throw new Error(
            `Invitation slot ${invitation.slotKey} already has different configuration`,
          )
        }
        continue
      }
      const invitationId = await ctx.db.insert("invitations", {
        ...invitation,
        status: "available",
        createdAt: now,
      })
      await ctx.db.insert("auditEvents", {
        actor: { type: "system" },
        action: "invitation_seeded",
        targetType: "invitation",
        targetId: invitationId,
        occurredAt: now,
      })
      created += 1
    }

    const total = (await ctx.db.query("invitations").collect()).length
    if (total !== 5) {
      throw new Error("Invitation setup must leave exactly five slots")
    }
    return { created, total }
  },
})

export const listForSetup = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("invitations").collect(),
})

export const bootstrapConfigured = action({
  args: {},
  returns: v.object({ created: v.number(), total: v.number() }),
  handler: async (ctx): Promise<{ created: number; total: number }> => {
    const pepper = process.env.INVITATION_CODE_PEPPER
    const config = process.env.INVITATION_SEED_CONFIG
    if (!pepper || !config) {
      throw new Error("Invitation bootstrap is not configured")
    }
    const configuredInvitations = parseConfiguredInvitations(config)
    const invitations = await Promise.all(
      configuredInvitations.map(async (invitation) => ({
        slotKey: invitation.slotKey,
        role: invitation.role,
        codeDigest: await digestInvitationCode(invitation.code, pepper),
      })),
    )
    return ctx.runMutation(internal.invitations.seedForSetup, { invitations })
  },
})

export const claim = action({
  args: { code: v.string() },
  returns: v.object({ visitorId: v.id("visitors"), role: visitorRoleValidator }),
  handler: async (ctx, args): Promise<{ visitorId: Id<"visitors">; role: "admin" | "analyst" }> => {
    const authUserId = await getAuthUserId(ctx)
    if (!authUserId) {
      throw new Error("Not authenticated")
    }
    const pepper = process.env.INVITATION_CODE_PEPPER
    if (!pepper) {
      throw new Error("Invitation claim is not configured")
    }
    const codeDigest = await digestInvitationCode(args.code, pepper)
    return ctx.runMutation(internal.invitations.claimDigest, { authUserId, codeDigest })
  },
})

export const claimDigest = internalMutation({
  args: { authUserId: v.id("users"), codeDigest: v.string() },
  returns: v.object({ visitorId: v.id("visitors"), role: visitorRoleValidator }),
  handler: async (ctx, args) => {
    const existingVisitor = await ctx.db
      .query("visitors")
      .withIndex("by_auth_user_id", (query) => query.eq("authUserId", args.authUserId))
      .unique()
    if (existingVisitor) {
      const existingInvitation = await ctx.db.get(existingVisitor.invitationId)
      if (
        existingInvitation?.codeDigest === args.codeDigest &&
        existingVisitor.status === "active"
      ) {
        return { visitorId: existingVisitor._id, role: existingVisitor.role }
      }
      throw new Error("Authenticated user is already linked to a visitor")
    }

    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_code_digest", (query) => query.eq("codeDigest", args.codeDigest))
      .unique()
    if (invitation?.status !== "available") {
      throw new Error("Invitation is not available")
    }

    const now = Date.now()
    const visitorId = await ctx.db.insert("visitors", {
      authUserId: args.authUserId,
      invitationId: invitation._id,
      role: invitation.role,
      status: "active",
      analysesReserved: 0,
      admittedAt: now,
    })
    await ctx.db.patch(invitation._id, {
      status: "claimed",
      claimedByVisitorId: visitorId,
      claimedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      actor: { type: "visitor", visitorId },
      action: "invitation_claimed",
      targetType: "invitation",
      targetId: invitation._id,
      occurredAt: now,
    })
    return { visitorId, role: invitation.role }
  },
})

export const rotateAdminFromConfig = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const pepper = process.env.INVITATION_CODE_PEPPER
    const recoveryCode = process.env.INVITATION_ADMIN_RECOVERY_CODE
    if (!pepper || !recoveryCode || recoveryCode.length < 16) {
      throw new Error("Admin invitation recovery is not configured")
    }
    const codeDigest = await digestInvitationCode(recoveryCode, pepper)
    await ctx.runMutation(internal.invitations.rotateAdminDigest, { codeDigest })
    return null
  },
})

export const rotateAdminDigest = internalMutation({
  args: { codeDigest: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_slot_key", (query) => query.eq("slotKey", "admin"))
      .unique()
    if (invitation?.role !== "admin") {
      throw new Error("Admin invitation slot not found")
    }
    const digestOwner = await ctx.db
      .query("invitations")
      .withIndex("by_code_digest", (query) => query.eq("codeDigest", args.codeDigest))
      .unique()
    if (digestOwner && digestOwner._id !== invitation._id) {
      throw new Error("Recovery code is already assigned")
    }

    const now = Date.now()
    if (invitation.claimedByVisitorId) {
      await ctx.db.patch(invitation.claimedByVisitorId, { status: "revoked", revokedAt: now })
      await ctx.db.insert("auditEvents", {
        actor: { type: "system" },
        action: "invitation_revoked",
        targetType: "visitor",
        targetId: invitation.claimedByVisitorId,
        reason: "Break-glass admin invitation rotation",
        occurredAt: now,
      })
    }
    await ctx.db.patch(invitation._id, {
      codeDigest: args.codeDigest,
      status: "available",
      claimedByVisitorId: undefined,
      claimedAt: undefined,
      revokedAt: undefined,
    })
    await ctx.db.insert("auditEvents", {
      actor: { type: "system" },
      action: "invitation_reissued",
      targetType: "invitation",
      targetId: invitation._id,
      reason: "Break-glass admin invitation rotation",
      occurredAt: now,
    })
    return null
  },
})
