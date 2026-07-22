import { getAuthUserId } from "@convex-dev/auth/server"

import { query } from "./_generated/server"

export const current = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx)
    if (!authUserId) {
      return null
    }
    return ctx.db
      .query("visitors")
      .withIndex("by_auth_user_id", (builder) => builder.eq("authUserId", authUserId))
      .unique()
  },
})
