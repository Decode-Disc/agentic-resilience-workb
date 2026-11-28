export {
    readCampaignResearchDeadline,
    readWorkbenchQualification,
    readWorkbenchQualificationDeadline,
    SOURCES_QUALIFICATION_ENVELOPE,
} from "./qualificationAccess";

import { runMatchesWorkspace } from "@convex/domain/browserFixtureAccess";

export { runMatchesWorkspace } from "@convex/domain/browserFixtureAccess";

import {
    MAX_QUALIFICATION_CONTEXT_DURATION_MS,
    PERSISTENCE_PAGE_SIZE,
} from "@convex/resourcePolicy";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "./_generated/server";
import {
    isLoopbackDeployment,
    isReservedAnalystSlot,
    requireBrowserTestOwner,
    workspaceForVisitor,
} from "./domain/browserFixtureAccess";

export {
    BROWSER_TEST_SLOT,
    isBrowserTestSlot,
    isE2EWorkerSlot,
    isLoopbackDeployment,
    localBrowserFixturesEnabled,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
    requireBrowserTestRunOwner,
    workspaceForVisitor,
} from "./domain/browserFixtureAccess";

import { cancelRunExecution } from "./domain/runCancellation";

type AccessDenied = (code: "not_authenticated" | "not_authorized") => Error;

export async function readWorkspace(ctx: QueryCtx, denied?: AccessDenied) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId)
        throw denied?.("not_authenticated") ?? new Error("Not authenticated");
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
        .unique();
    if (visitor?.status !== "active")
        throw denied?.("not_authorized") ?? new Error("Unauthorized");
    return { visitor, workspace: await workspaceForVisitor(ctx, visitor) };
}

export async function requireWorkspaceRun(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    denied?: AccessDenied,
) {
    const { visitor, workspace } = await readWorkspace(ctx, denied);
    const run = await ctx.db.get(runId);
    if (!run || run.ownerVisitorId !== visitor._id)
        throw denied?.("not_authorized") ?? new Error("Unauthorized");
    if (!runMatchesWorkspace(run, workspace))
        throw denied?.("not_authorized") ?? new Error("Unauthorized");
    return { run, visitor, workspace };
}

export const openBrowserTestContext = internalMutation({
    args: {
        slotKey: v.string(),
        contextKey: v.string(),
        durationMs: v.number(),
    },
    returns: v.id("browserTestContexts"),
    handler: async (ctx, args): Promise<Id<"browserTestContexts">> => {
        const visitor = await requireBrowserTestOwner(ctx, args.slotKey);
        const now = Date.now();
        if (
            !/^[a-zA-Z0-9._:-]{1,120}$/.test(args.contextKey) ||
            !Number.isSafeInteger(args.durationMs) ||
            args.durationMs < 1 ||
            args.durationMs > MAX_QUALIFICATION_CONTEXT_DURATION_MS
        )
            throw new Error("Invalid browser test context");
        const previous = await ctx.db
            .query("browserTestContexts")
            .withIndex("by_owner_and_context_key", (q) =>
                q
                    .eq("ownerVisitorId", visitor._id)
                    .eq("contextKey", args.contextKey),
            )
            .unique();
        const active = await ctx.db
            .query("browserTestContexts")
            .withIndex("by_auth_user_id_and_status", (q) =>
                q.eq("authUserId", visitor.authUserId).eq("status", "active"),
            )
            .unique();
        if (active && active._id !== previous?._id) {
            if (active.expiresAt > now)
                throw new Error("Another browser test context is active");
            await ctx.db.patch(active._id, { status: "closed", closedAt: now });
        }
        if (previous) {
            if (previous.status !== "active" || previous.expiresAt <= now)
                throw new Error("Browser test context is closed");
            await ctx.db.patch(previous._id, {
                authUserId: visitor.authUserId,
            });
            return previous._id;
        }
        const contextId = await ctx.db.insert("browserTestContexts", {
            ownerVisitorId: visitor._id,
            authUserId: visitor.authUserId,
            contextKey: args.contextKey,
            status: "active",
            expiresAt: now + args.durationMs,
            createdAt: now,
        });
        await ctx.scheduler.runAfter(
            args.durationMs,
            internal.runWorkspace.closeBrowserTestContext,
            { slotKey: args.slotKey, contextKey: args.contextKey },
        );
        await ctx.db.insert("auditEvents", {
            actor: { type: "system" },
            action: "browser_test_context_opened",
            targetType: "browser_test_context",
            targetId: contextId,
            occurredAt: now,
        });
        return contextId;
    },
});

export const closeBrowserTestContext = internalMutation({
    args: {
        slotKey: v.string(),
        contextKey: v.string(),
        cursor: v.optional(v.string()),
    },
    returns: v.object({
        done: v.boolean(),
        cursor: v.string(),
        cancelled: v.number(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ done: boolean; cursor: string; cancelled: number }> => {
        // Closing also works after the fixture switch is removed; it cannot create work.
        if (!isReservedAnalystSlot(args.slotKey) || !isLoopbackDeployment())
            throw new Error("Local browser test slot required");
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", args.slotKey))
            .unique();
        if (!invitation?.claimedByVisitorId)
            return { done: true, cursor: "", cancelled: 0 };
        const ownerVisitorId = invitation.claimedByVisitorId;
        const context = await ctx.db
            .query("browserTestContexts")
            .withIndex("by_owner_and_context_key", (q) =>
                q
                    .eq("ownerVisitorId", ownerVisitorId)
                    .eq("contextKey", args.contextKey),
            )
            .unique();
        if (!context) return { done: true, cursor: "", cancelled: 0 };
        if (context.status !== "closed") {
            await ctx.db.patch(context._id, {
                status: "closed",
                closedAt: Date.now(),
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "system" },
                action: "browser_test_context_closed",
                targetType: "browser_test_context",
                targetId: context._id,
                occurredAt: Date.now(),
            });
        }
        const page = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_purpose_and_context_and_updated_at", (q) =>
                q
                    .eq("ownerVisitorId", context.ownerVisitorId)
                    .eq("purpose", "browser_test")
                    .eq("browserTestContextId", context._id),
            )
            .order("desc")
            .paginate({
                numItems: PERSISTENCE_PAGE_SIZE.runContextCleanup,
                cursor: args.cursor ?? null,
            });
        let cancelled = 0;
        for (const run of page.page)
            if (
                run.executionStatus === "running" ||
                run.executionStatus === "paused"
            ) {
                await cancelRunExecution(ctx, run);
                cancelled++;
            }
        if (!page.isDone)
            await ctx.scheduler.runAfter(
                0,
                internal.runWorkspace.closeBrowserTestContext,
                { ...args, cursor: page.continueCursor },
            );
        return { done: page.isDone, cursor: page.continueCursor, cancelled };
    },
});

/** Blocks unscoped provider actions as well as run-bound work from the reserved test principal. */
export const authorizeProvider = internalQuery({
    args: { runId: v.optional(v.id("researchRuns")) },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        if (args.runId) await requireWorkspaceRun(ctx, args.runId);
        const userId = await getAuthUserId(ctx);
        const visitor = userId
            ? await ctx.db
                  .query("visitors")
                  .withIndex("by_auth_user_id", (q) =>
                      q.eq("authUserId", userId),
                  )
                  .unique()
            : null;
        if (visitor && (await workspaceForVisitor(ctx, visitor)).isTestData)
            return false;
        return true;
    },
});
