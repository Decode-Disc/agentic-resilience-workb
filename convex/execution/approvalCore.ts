import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    approvalDecisionText,
    approvalNoticeText,
    approvalOutcomeText,
} from "@convex/domain/approvalCopy";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { approvalCatalog } from "./approvalCatalog";
import type {
    ApprovalAction,
    ApprovalRequester,
    ApprovalRequestView,
    ApprovalStatus,
    AuditActor,
} from "./approvalContracts";
import { requireDossierAuthority } from "./authority";
import {
    recordApprovalNotice,
    recordControlExchange,
} from "./conversationCore";
import { executionError } from "./errors";
export async function recordApprovalReceipt(
    ctx: MutationCtx,
    request: Doc<"approvalRequests">,
): Promise<void> {
    if (!request.decision) return;
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", request.runId))
        .unique();
    if (!conversation) return;
    const view = await readApprovalView(ctx, request);
    const userText = approvalDecisionText(request.action, request.decision);
    const text = approvalOutcomeText(view);
    await recordControlExchange(ctx, conversation, {
        requestKey: `approval-decision:${request._id}`,
        contentHash: sha256Hex(
            stableStringify({ requestId: request._id, userText, text }),
        ),
        exchange: {
            kind: "approval",
            requestId: request._id,
            text: userText,
        },
        text,
    });
}

async function findPendingRequest(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    action: ApprovalAction,
): Promise<Doc<"approvalRequests"> | null> {
    const pending = await ctx.db
        .query("approvalRequests")
        .withIndex("by_run_and_status", (q) =>
            q.eq("runId", run._id).eq("status", "pending"),
        )
        .collect();
    const current = pending.filter(
        (request) => request.expectedGeneration === run.executionGeneration,
    );
    return (
        current.find((request) => request.action === action) ??
        current.find((request) => request.alternative === action) ??
        null
    );
}

export async function listActiveGrantsForRun(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
): Promise<Doc<"approvalGrants">[]> {
    const grants = await ctx.db
        .query("approvalGrants")
        .withIndex("by_run_and_action", (q) => q.eq("runId", runId))
        .collect();
    return grants
        .filter((grant) => grant.revokedAt === undefined)
        .sort((left, right) => left.grantedAt - right.grantedAt);
}

/** The single derivation of a request's status; every reader uses it. */
export function approvalStatus(
    request: Doc<"approvalRequests">,
    run: Doc<"researchRuns">,
): ApprovalStatus {
    if (request.status !== "pending") return request.status;
    return request.expectedGeneration === run.executionGeneration
        ? "pending"
        : "superseded";
}

export async function activeGrant(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    action: ApprovalAction,
): Promise<Doc<"approvalGrants"> | null> {
    const grants = await ctx.db
        .query("approvalGrants")
        .withIndex("by_run_and_action", (q) =>
            q.eq("runId", runId).eq("action", action),
        )
        .order("desc")
        .collect();
    return grants.find((grant) => grant.revokedAt === undefined) ?? null;
}

export async function readApprovalView(
    ctx: QueryCtx,
    request: Doc<"approvalRequests">,
): Promise<ApprovalRequestView> {
    const run = await ctx.db.get(request.runId);
    if (!run) throw executionError("not_authorized");
    const status = approvalStatus(request, run);
    // The grant that matters is the one for the action that ran, which may be the request's alternative.
    const grantAction =
        request.decision?.outcome.kind === "applied"
            ? request.decision.outcome.action
            : request.action;
    const [block, grant] = await Promise.all([
        status === "pending"
            ? approvalCatalog[request.action].availability(ctx, run)
            : Promise.resolve(null),
        activeGrant(ctx, request.runId, grantAction),
    ]);
    return {
        id: request._id,
        runId: request.runId,
        action: request.action,
        alternative: request.alternative ?? null,
        requestedBy: request.requestedBy,
        status,
        block,
        decision: request.decision ?? null,
        grantActive: grant !== null,
        createdAt: request.createdAt,
    };
}

export async function readApprovalFacts(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<{
    pending: {
        requestId: Id<"approvalRequests">;
        action: ApprovalAction;
        alternative: ApprovalAction | null;
        block: string | null;
    }[];
    grants: ApprovalAction[];
}> {
    const [pendingRows, activeGrants] = await Promise.all([
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", run._id).eq("status", "pending"),
            )
            .collect(),
        listActiveGrantsForRun(ctx, run._id),
    ]);
    const currentPending = pendingRows.filter(
        (request) => approvalStatus(request, run) === "pending",
    );
    const pending = await Promise.all(
        currentPending.map(async (request) => ({
            requestId: request._id,
            action: request.action,
            alternative: request.alternative ?? null,
            block: await approvalCatalog[request.action].availability(ctx, run),
        })),
    );
    const grants: ApprovalAction[] = [];
    for (const grant of activeGrants) {
        if (!grants.includes(grant.action)) grants.push(grant.action);
    }
    return { pending, grants };
}

/** The pending Continue request for the run's current generation, read by getMine and snapshot. */
export async function readSourcesDecisionRequestId(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<Id<"approvalRequests"> | null> {
    const requests = await ctx.db
        .query("approvalRequests")
        .withIndex("by_run_action_generation", (q) =>
            q
                .eq("runId", run._id)
                .eq(
                    "action",
                    run.pauseReason === "execution_interrupted"
                        ? "settle_sources_preparation"
                        : "continue_sources_preparation",
                )
                .eq("expectedGeneration", run.executionGeneration),
        )
        .collect();
    const pending = requests.find(
        (request) => approvalStatus(request, run) === "pending",
    );
    return pending?._id ?? null;
}

/** Creates or reuses the request for this action at the run's generation. When the action, or else its alternative, has an active grant and is available, applies it inline (via "grant"); otherwise leaves it pending. */
export async function raiseApproval(
    ctx: MutationCtx,
    args: {
        run: Doc<"researchRuns">;
        action: ApprovalAction;
        alternative?: ApprovalAction;
        requestedBy: ApprovalRequester;
    },
): Promise<{
    requestId: Id<"approvalRequests">;
    status: "pending" | "applied";
}> {
    const { run } = await requireDossierAuthority(ctx, args.run._id);
    if (run.executionGeneration !== args.run.executionGeneration)
        throw executionError("stale_execution");

    const existing = await findPendingRequest(ctx, run, args.action);
    const now = Date.now();
    const requestId = existing
        ? existing._id
        : await ctx.db.insert("approvalRequests", {
              runId: run._id,
              action: args.action,
              ...(args.alternative !== undefined
                  ? { alternative: args.alternative }
                  : {}),
              requestedBy: args.requestedBy,
              expectedGeneration: run.executionGeneration,
              status: "pending",
              createdAt: now,
          });

    for (const candidate of args.alternative === undefined
        ? [args.action]
        : [args.action, args.alternative]) {
        if (!(await activeGrant(ctx, run._id, candidate))) continue;
        const definition = approvalCatalog[candidate];
        if ((await definition.availability(ctx, run)) !== null) continue;
        const actor: AuditActor = { type: "system" };
        await definition.apply(ctx, { run, actor });
        await ctx.db.patch(requestId, {
            status: "approved",
            decision: {
                choice: "always",
                via: "grant",
                decidedBy: actor,
                decidedAt: now,
                outcome: { kind: "applied", action: candidate },
            },
        });
        return { requestId, status: "applied" };
    }
    return { requestId, status: "pending" };
}

/** Raises a system request and posts it in the dossier's conversation, whether it waits for a choice or a standing permission already applied it. */
export async function raiseSystemApproval(
    ctx: MutationCtx,
    args: {
        run: Doc<"researchRuns">;
        action: ApprovalAction;
        alternative?: ApprovalAction;
    },
): Promise<Id<"approvalRequests">> {
    const { requestId } = await raiseApproval(ctx, {
        ...args,
        requestedBy: { type: "system" },
    });
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", args.run._id))
        .unique();
    const request = await ctx.db.get(requestId);
    if (conversation && request)
        await recordApprovalNotice(ctx, conversation, {
            requestId,
            text: approvalNoticeText(await readApprovalView(ctx, request)),
        });
    return requestId;
}

/** An exact command message is itself the decision: records an approved request (via "command") and applies the action, or throws its availability code. */
export async function recordCommandApproval(
    ctx: MutationCtx,
    args: {
        run: Doc<"researchRuns">;
        action: "pause_research" | "resume_research";
        requestedBy: Extract<ApprovalRequester, { type: "agent" }>;
        decidedBy: AuditActor;
    },
): Promise<Id<"approvalRequests">> {
    const { run, visitor } = await requireDossierAuthority(ctx, args.run._id);
    if (run.executionGeneration !== args.run.executionGeneration)
        throw executionError("stale_execution");
    if (
        args.decidedBy.type === "visitor" &&
        args.decidedBy.visitorId !== visitor._id
    )
        throw executionError("not_authorized");

    const definition = approvalCatalog[args.action];
    const block = await definition.availability(ctx, run);
    if (block !== null) throw executionError(block);

    await definition.apply(ctx, { run, actor: args.decidedBy });

    const now = Date.now();
    const decision = {
        choice: "once" as const,
        via: "command" as const,
        decidedBy: args.decidedBy,
        decidedAt: now,
        outcome: { kind: "applied" as const, action: args.action },
    };
    const existing = await findPendingRequest(ctx, run, args.action);
    let requestId: Id<"approvalRequests">;
    if (existing) {
        await ctx.db.patch(existing._id, {
            status: "approved",
            decision,
        });
        requestId = existing._id;
    } else {
        requestId = await ctx.db.insert("approvalRequests", {
            runId: run._id,
            action: args.action,
            requestedBy: args.requestedBy,
            expectedGeneration: run.executionGeneration,
            status: "approved",
            decision,
            createdAt: now,
        });
    }

    if (args.decidedBy.type === "visitor") {
        const stored = await ctx.db.get(requestId);
        if (stored) await recordApprovalReceipt(ctx, stored);
    }
    return requestId;
}
