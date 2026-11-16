import {
    MAX_QUALIFICATION_CONTEXT_DURATION_MS,
    PERSISTENCE_PAGE_SIZE,
    SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS,
} from "@convex/resourcePolicy";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
    env,
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "./_generated/server";
import { cancelRunExecution } from "./domain/runCancellation";
import { requireCampaignLot } from "./qualificationCampaigns";
import { RESOURCE_POLICY_VERSION } from "./resourcePolicy";

export const BROWSER_TEST_SLOT = "analyst-4";
const WORKER_ANALYST_SLOT_PATTERN = /^analyst-4-w[1-9]\d*$/;
const WORKER_ADMIN_SLOT_PATTERN = /^admin-w[1-9]\d*$/;

export function isLoopbackDeployment(): boolean {
    try {
        return ["127.0.0.1", "localhost"].includes(
            new URL(env.CONVEX_CLOUD_URL).hostname,
        );
    } catch {
        return false;
    }
}

export function isE2EWorkerSlot(slotKey: string | undefined): boolean {
    return (
        WORKER_ANALYST_SLOT_PATTERN.test(slotKey ?? "") ||
        WORKER_ADMIN_SLOT_PATTERN.test(slotKey ?? "")
    );
}

export function isBrowserTestSlot(slotKey: string | undefined): boolean {
    return (
        slotKey === BROWSER_TEST_SLOT ||
        (localBrowserFixturesEnabled() &&
            WORKER_ANALYST_SLOT_PATTERN.test(slotKey ?? ""))
    );
}

/** Fixed limits of the explicitly authorized local two-dossier Sources qualification. */
export const SOURCES_QUALIFICATION_ENVELOPE = {
    version: 1 as const,
    maxNeeds: 4,
    initialSearches: 2,
    complementSearches: 1,
    acquisitions: 6,
    controls: 8,
};
export function localBrowserFixturesEnabled() {
    return env.E2E_FIXTURES_ENABLED === "true" && isLoopbackDeployment();
}

/** Resolves the workspace from the admitted principal; callers cannot choose a namespace. */
export async function workspaceForVisitor(
    ctx: QueryCtx,
    visitor: Doc<"visitors">,
) {
    const invitation = await ctx.db.get(visitor.invitationId);
    if (!isBrowserTestSlot(invitation?.slotKey))
        return {
            key: `research:${visitor._id}`,
            purpose: "research" as const,
            contextId: null,
            isTestData: false,
            canStartDossier: true,
        };
    const context = localBrowserFixturesEnabled()
        ? await ctx.db
              .query("browserTestContexts")
              .withIndex("by_auth_user_id_and_status", (q) =>
                  q.eq("authUserId", visitor.authUserId).eq("status", "active"),
              )
              .unique()
        : null;
    const active =
        context &&
        context.ownerVisitorId === visitor._id &&
        context.expiresAt > Date.now()
            ? context
            : null;
    return {
        key: active
            ? `browser_test:${active._id}`
            : `browser_test:unavailable:${visitor._id}`,
        purpose: "browser_test" as const,
        contextId: active?._id ?? null,
        isTestData: true,
        canStartDossier: false,
    };
}

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

/** Namespace membership is shared by projections and authorization, never inferred in React. */
export function runMatchesWorkspace(
    run: Doc<"researchRuns">,
    workspace: Awaited<ReturnType<typeof workspaceForVisitor>>,
) {
    const purpose = run.purpose;
    return (
        purpose === workspace.purpose &&
        (purpose !== "browser_test" ||
            (!!workspace.contextId &&
                run.browserTestContextId === workspace.contextId))
    );
}

/** Internal fixture authors use the admitted test principal, never caller-supplied user IDs. */
export async function requireBrowserFixtureContext(
    ctx: QueryCtx,
    visitor: Doc<"visitors">,
) {
    if (!localBrowserFixturesEnabled())
        throw new Error("Local browser fixtures are disabled");
    const workspace = await workspaceForVisitor(ctx, visitor);
    if (!workspace.contextId)
        throw new Error("Active browser test context required");
    return workspace.contextId;
}

/** Derives the current anonymous test principal from the claimed reserved invitation. */
export async function requireBrowserTestOwner(ctx: QueryCtx, slotKey: string) {
    if (!localBrowserFixturesEnabled() || !isBrowserTestSlot(slotKey))
        throw new Error("Local browser test slot required");
    const invitation = await ctx.db
        .query("invitations")
        .withIndex("by_slot_key", (q) => q.eq("slotKey", slotKey))
        .unique();
    const visitor = invitation?.claimedByVisitorId
        ? await ctx.db.get(invitation.claimedByVisitorId)
        : null;
    const user = visitor ? await ctx.db.get(visitor.authUserId) : null;
    if (
        invitation?.status !== "claimed" ||
        visitor?.status !== "active" ||
        !user?.isAnonymous
    )
        throw new Error("Admitted anonymous browser test visitor required");
    return visitor;
}

/** Derives and validates the browser-test visitor owning `run` via its claimed invitation slot. */
export async function requireBrowserTestRunOwner(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (!run.ownerVisitorId)
        throw new Error("Admitted anonymous browser test visitor required");
    const owner = await ctx.db.get(run.ownerVisitorId);
    const invitation = owner ? await ctx.db.get(owner.invitationId) : null;
    const verified = await requireBrowserTestOwner(ctx, invitation?.slotKey ?? "");
    if (!owner || verified._id !== owner._id)
        throw new Error("Admitted anonymous browser test visitor required");
    return verified;
}

async function readQualificationScope(ctx: QueryCtx, run: Doc<"researchRuns">) {
    if (run.purpose !== "browser_test" || !run.browserTestContextId)
        return null;
    const context = await ctx.db.get(run.browserTestContextId);
    const grant = context?.paidQualification;
    if (
        !context ||
        !grant ||
        context.ownerVisitorId !== run.ownerVisitorId ||
        !(grant.scenarios
            ? grant.scenarios.some((s) => s.runId === run._id)
            : grant.sourcesLot
              ? grant.sourcesLot.includes(run._id)
              : grant.runId === run._id)
    )
        return null;
    const lot = context.campaignLotId
        ? await ctx.db.get(context.campaignLotId)
        : null;
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    const durationMs =
        campaign && campaign.manifest.version !== 1
            ? campaign.manifest.researchDurationMs
            : undefined;
    const researchDeadlineAt =
        grant.sourcesLot && run.researchStartedAt !== undefined
            ? run.researchStartedAt +
              (durationMs ?? SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS)
            : undefined;
    const deadlineAt = Math.min(
        context.expiresAt,
        context.campaignLotId ? (campaign?.manifest.expiresAt ?? 0) : Infinity,
        researchDeadlineAt ?? Infinity,
    );
    return {
        context,
        deadlineAt,
        campaignResearchDeadlineAt:
            durationMs !== undefined && researchDeadlineAt !== undefined
                ? deadlineAt
                : undefined,
    };
}

/** Factual bound, including expired grants. This projection never grants spending or progression authority. */
export async function readWorkbenchQualificationDeadline(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    return (await readQualificationScope(ctx, run))?.deadlineAt;
}

/** Original explicit campaign bound, including expiry; absence preserves legacy clocks. This does not authorize I/O. */
export async function readCampaignResearchDeadline(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    return (await readQualificationScope(ctx, run))?.campaignResearchDeadlineAt;
}

/** A fixture remains unpaid unless its active local context explicitly authorizes this framing dossier. */
export async function readWorkbenchQualification(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (
        !localBrowserFixturesEnabled() ||
        run.purpose !== "browser_test" ||
        !run.browserTestContextId ||
        run.withdrawnAt !== undefined
    )
        return null;
    const scope = await readQualificationScope(ctx, run);
    if (scope?.context.status !== "active" || scope.deadlineAt <= Date.now())
        return null;
    const { context } = scope;
    if (
        !context.paidQualification?.sourcesLot &&
        (run.lifecycleState !== "framing" ||
            run.researchStartedAt !== undefined ||
            run.executionStatus !== "idle")
    )
        return null;
    if (
        context.paidQualification?.resourcePolicy !== RESOURCE_POLICY_VERSION ||
        context.paidQualification.costAccountingPolicy !== "known_final_v1"
    )
        throw new ConvexError({
            area: "execution",
            code: "resource_policy_unsupported",
        });
    if (context.campaignLotId)
        await requireCampaignLot(ctx, context.campaignLotId);
    const visitor = await requireBrowserTestRunOwner(ctx, run);
    if (
        visitor._id !== context.ownerVisitorId ||
        visitor.authUserId !== context.authUserId
    )
        return null;
    return {
        ...context.paidQualification,
        deadlineAt: scope.deadlineAt,
    };
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
        if (
            (args.slotKey !== BROWSER_TEST_SLOT &&
                !WORKER_ANALYST_SLOT_PATTERN.test(args.slotKey)) ||
            !isLoopbackDeployment()
        )
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
