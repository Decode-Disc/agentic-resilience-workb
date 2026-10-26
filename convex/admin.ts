import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation } from "./_generated/server";

export const restoreQuota = mutation({
    args: { runId: v.id("researchRuns"), reason: v.string() },
    returns: v.object({ restored: v.boolean() }),
    handler: async (ctx, args) => {
        const reason = args.reason.trim();
        if (reason.length < 12 || reason.length > 500) {
            throw new Error("Quota restoration requires a specific reason");
        }
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const admin = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", authUserId),
            )
            .unique();
        if (admin?.status !== "active" || admin.role !== "admin") {
            throw new Error("Unauthorized");
        }

        const run = await ctx.db.get(args.runId);
        if (!run?.ownerVisitorId || !run.reservationStatus) {
            throw new Error("Reserved research run not found");
        }
        if (run.purpose !== "research")
            throw new Error("Only research reservations can be restored");
        if (run.reservationStatus === "restored") {
            return { restored: false };
        }
        if (
            !(run.lifecycleState === "draft" && run.executionStatus === "idle")
        ) {
            throw new Error("Only an unused reservation can be restored");
        }
        const owner = await ctx.db.get(run.ownerVisitorId);
        if (!owner || owner.analysesReserved < 1) {
            throw new Error("Reservation owner is inconsistent");
        }

        const now = Date.now();
        await ctx.db.patch(run._id, {
            reservationStatus: "restored",
            quotaRestoredAt: now,
            updatedAt: now,
        });
        await ctx.db.patch(owner._id, {
            analysesReserved: owner.analysesReserved - 1,
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "quota_restored",
            targetType: "research_run",
            targetId: run._id,
            reason,
            occurredAt: now,
        });
        return { restored: true };
    },
});
