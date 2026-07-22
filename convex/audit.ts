import { v } from "convex/values"

import { internalMutation, internalQuery } from "./_generated/server"
import { auditEventActionValidator } from "./domain/validators"

export const appendSystemEvent = internalMutation({
  args: {
    action: auditEventActionValidator,
    targetType: v.string(),
    targetId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.id("auditEvents"),
  handler: async (ctx, args) =>
    ctx.db.insert("auditEvents", {
      actor: { type: "system" },
      ...args,
      occurredAt: Date.now(),
    }),
})

export const listByTarget = internalQuery({
  args: { targetType: v.string(), targetId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("auditEvents")
      .withIndex("by_target", (query) =>
        query.eq("targetType", args.targetType).eq("targetId", args.targetId),
      )
      .collect(),
})
