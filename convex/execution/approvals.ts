import {
    activeGrant,
    approvalStatus,
    listActiveGrantsForRun,
    raiseApproval,
    readApprovalView,
    recordApprovalReceipt,
} from "./approvalCore";

export {
    activeGrant,
    approvalStatus,
    listActiveGrantsForRun,
    raiseApproval,
    raiseSystemApproval,
    readApprovalFacts,
    readApprovalView,
    readSourcesDecisionRequestId,
    recordApprovalReceipt,
    recordCommandApproval,
} from "./approvalCore";

import { api } from "@convex/_generated/api";
import { mutation, query } from "@convex/_generated/server";
import { readWorkspace, requireWorkspaceRun } from "@convex/runWorkspace";
import { v } from "convex/values";
import { approvalCatalog } from "./approvalCatalog";
import {
    type ApprovalRequestView,
    type AuditActor,
    approvalActionValidator,
    approvalChoiceValidator,
    approvalRequestViewValidator,
} from "./approvalContracts";
import { requireDossierAuthority } from "./authority";
import { executionError } from "./errors";

/** A named analyst button makes the same recorded settlement decision as its approval card, atomically. */
export const usePreparedSources = mutation({
    args: { runId: v.id("researchRuns"), expectedGeneration: v.number() },
    returns: approvalRequestViewValidator,
    handler: async (ctx, args): Promise<ApprovalRequestView> => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        if (run.executionGeneration !== args.expectedGeneration)
            throw executionError("stale_execution");
        const block =
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            );
        if (block) throw executionError(block);
        const { requestId, status } = await raiseApproval(ctx, {
            run,
            action: "settle_sources_preparation",
            requestedBy: { type: "system" },
        });
        if (status === "applied") {
            const request = await ctx.db.get(requestId);
            if (!request) throw executionError("stale_execution");
            return readApprovalView(ctx, request);
        }
        return ctx.runMutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        });
    },
});

export const decide = mutation({
    args: {
        requestId: v.id("approvalRequests"),
        choice: approvalChoiceValidator,
    },
    returns: approvalRequestViewValidator,
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (!request) {
            await readWorkspace(ctx);
            throw executionError("not_authorized");
        }
        const { run, visitor } = await requireWorkspaceRun(ctx, request.runId);
        const status = approvalStatus(request, run);
        if (status === "approved" || status === "denied") {
            if (request.decision?.choice === args.choice)
                return readApprovalView(ctx, request);
            throw executionError("approval_already_decided");
        }
        if (status === "superseded") throw executionError("stale_execution");

        await requireDossierAuthority(ctx, run._id);

        const actor: AuditActor = { type: "visitor", visitorId: visitor._id };
        const now = Date.now();

        if (args.choice === "deny") {
            // A request with an alternative is a choice between two actions; refusing both is not offered.
            if (request.alternative)
                throw executionError("approval_choice_unavailable");
            await ctx.db.patch(request._id, {
                status: "denied",
                decision: {
                    choice: "deny",
                    via: "card",
                    decidedBy: actor,
                    decidedAt: now,
                    outcome: { kind: "none" },
                },
            });
        } else {
            const targetAction =
                args.choice === "alternative"
                    ? request.alternative
                    : request.action;
            if (!targetAction)
                throw executionError("approval_choice_unavailable");

            const definition = approvalCatalog[targetAction];
            const block = await definition.availability(ctx, run);
            if (block !== null) throw executionError(block);

            await definition.apply(ctx, { run, actor });

            if (args.choice === "always") {
                const currentGrant = await activeGrant(
                    ctx,
                    run._id,
                    targetAction,
                );
                if (!currentGrant) {
                    await ctx.db.insert("approvalGrants", {
                        runId: run._id,
                        action: targetAction,
                        grantedBy: actor,
                        grantedAt: now,
                    });
                }
                for (const excluded of definition.exclusiveWith) {
                    const excludedGrants = await ctx.db
                        .query("approvalGrants")
                        .withIndex("by_run_and_action", (q) =>
                            q.eq("runId", run._id).eq("action", excluded),
                        )
                        .collect();
                    for (const grant of excludedGrants) {
                        if (grant.revokedAt === undefined) {
                            await ctx.db.patch(grant._id, {
                                revokedAt: now,
                                revokedBy: actor,
                            });
                        }
                    }
                }
            }

            await ctx.db.patch(request._id, {
                status: "approved",
                decision: {
                    choice: args.choice,
                    via: "card",
                    decidedBy: actor,
                    decidedAt: now,
                    outcome: { kind: "applied", action: targetAction },
                },
            });
        }

        const updated = await ctx.db.get(request._id);
        if (!updated) throw executionError("not_authorized");
        await recordApprovalReceipt(ctx, updated);
        return readApprovalView(ctx, updated);
    },
});

export const revokeGrant = mutation({
    args: {
        runId: v.id("researchRuns"),
        action: approvalActionValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, visitor } = await requireWorkspaceRun(ctx, args.runId);
        const grants = await ctx.db
            .query("approvalGrants")
            .withIndex("by_run_and_action", (q) =>
                q.eq("runId", run._id).eq("action", args.action),
            )
            .collect();
        const now = Date.now();
        const actor: AuditActor = { type: "visitor", visitorId: visitor._id };
        for (const grant of grants) {
            if (grant.revokedAt === undefined) {
                await ctx.db.patch(grant._id, {
                    revokedAt: now,
                    revokedBy: actor,
                });
            }
        }
        return null;
    },
});

export const get = query({
    args: { requestId: v.id("approvalRequests") },
    returns: approvalRequestViewValidator,
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (!request) {
            await readWorkspace(ctx);
            throw executionError("not_authorized");
        }
        await requireWorkspaceRun(ctx, request.runId);
        return readApprovalView(ctx, request);
    },
});

export const listGrants = query({
    args: { runId: v.id("researchRuns") },
    returns: v.array(
        v.object({
            action: approvalActionValidator,
            grantedAt: v.number(),
        }),
    ),
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        const active = await listActiveGrantsForRun(ctx, run._id);
        return active.map((grant) => ({
            action: grant.action,
            grantedAt: grant.grantedAt,
        }));
    },
});
