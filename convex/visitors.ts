import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { workspaceForVisitor } from "./runWorkspace";

export const current = query({
    args: {},
    handler: async (ctx) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            return null;
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (builder) =>
                builder.eq("authUserId", authUserId),
            )
            .unique();
        return visitor
            ? {
                  ...visitor,
                  workspace:
                      visitor.status === "active"
                          ? await workspaceForVisitor(ctx, visitor)
                          : null,
              }
            : null;
    },
});
