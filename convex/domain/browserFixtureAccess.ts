import type { Doc } from "@convex/_generated/dataModel";
import { env, type QueryCtx } from "@convex/_generated/server";

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

/** Closing an existing worker context remains available after fixture creation is disabled. */
export function isReservedAnalystSlot(slotKey: string) {
    return (
        slotKey === BROWSER_TEST_SLOT ||
        WORKER_ANALYST_SLOT_PATTERN.test(slotKey)
    );
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
    const verified = await requireBrowserTestOwner(
        ctx,
        invitation?.slotKey ?? "",
    );
    if (!owner || verified._id !== owner._id)
        throw new Error("Admitted anonymous browser test visitor required");
    return verified;
}
