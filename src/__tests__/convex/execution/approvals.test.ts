import { api } from "@convex/_generated/api";
import {
    activeGrant,
    approvalStatus,
    raiseApproval,
    readApprovalFacts,
    readApprovalView,
    readSourcesDecisionRequestId,
    recordCommandApproval,
} from "@convex/execution/approvals";
import { executionFailureCode } from "@convex/execution/errors";
import { resumeResearch } from "@convex/execution/researchControl";
import { afterEach, assert, expect, test, vi } from "vitest";
import { retainFixtureDelivery } from "@/__tests__/setup/retained-messages";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import {
    client,
    reachTimeLimit,
    seedExpiredPreparation,
} from "@/__tests__/setup/sources-time-limit";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function raiseSourcesTimeLimitApproval(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
) {
    return f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "continue_sources_preparation",
            alternative: "settle_sources_preparation",
            requestedBy: { type: "system" },
        });
    });
}

async function seedAgentMessageId(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
) {
    const deliveryId = await f.t.run(async (ctx) => {
        const now = Date.now();
        const conversationId = await ctx.db.insert("agentConversations", {
            runId: f.runId,
            queuedCount: 0,
            createdAt: now,
        });
        return ctx.db.insert("agentMessageDeliveries", {
            runId: f.runId,
            conversationId,
            requestKey: "req-approvals-test",
            contentHash: "hash-approvals-test",
            role: "assistant",
            delivery: "reply",
            status: "processed",
            createdAt: now,
        });
    });
    return retainFixtureDelivery(f.t, deliveryId, "Agent message");
}

test("raising the same action twice for one generation keeps one pending request", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const first = await raiseSourcesTimeLimitApproval(f);
    const second = await raiseSourcesTimeLimitApproval(f);

    expect(first.status).toBe("pending");
    expect(second).toEqual(first);

    // Raising the request's alternative at the same generation also reuses the pending request.
    const alternativeRaise = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "settle_sources_preparation",
            requestedBy: { type: "system" },
        });
    });
    expect(alternativeRaise).toEqual(first);

    const rows = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", f.runId).eq("status", "pending"),
            )
            .collect(),
    );
    expect(rows.map((row) => row._id)).toEqual([first.requestId]);
});

test("allow once applies the action through its owner and records the decision", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const before = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(before);
    const { requestId } = await raiseSourcesTimeLimitApproval(f);

    const view = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "once",
    });

    expect(view).toMatchObject({
        id: requestId,
        runId: f.runId,
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        requestedBy: { type: "system" },
        status: "approved",
        block: null,
        grantActive: false,
        decision: {
            choice: "once",
            via: "card",
            decidedBy: { type: "visitor", visitorId: f.visitorId },
            outcome: {
                kind: "applied",
                action: "continue_sources_preparation",
            },
        },
    });

    const after = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(after).toMatchObject({
        executionStatus: "running",
        executionGeneration: before.executionGeneration + 1,
    });

    const grants = await client(f).query(api.execution.approvals.listGrants, {
        runId: f.runId,
    });
    expect(grants).toEqual([]);
});

test("the alternative choice applies the named alternative", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const { requestId } = await raiseSourcesTimeLimitApproval(f);
    const view = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "alternative",
    });

    expect(view).toMatchObject({
        id: requestId,
        status: "approved",
        decision: {
            choice: "alternative",
            via: "card",
            decidedBy: { type: "visitor", visitorId: f.visitorId },
            outcome: {
                kind: "applied",
                action: "settle_sources_preparation",
            },
        },
    });

    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.settlementRequestedAt).toBeTypeOf("number");

    // A request without an alternative rejects the "alternative" choice.
    const noAlt = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "pause_research",
            requestedBy: { type: "system" },
        });
    });
    const error = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId: noAlt.requestId,
            choice: "alternative",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(error)).toBe("approval_choice_unavailable");
});

test("always allow saves a grant and the next request is applied by it", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const first = await raiseSourcesTimeLimitApproval(f);
    const firstView = await client(f).mutation(api.execution.approvals.decide, {
        requestId: first.requestId,
        choice: "always",
    });

    expect(firstView.status).toBe("approved");
    expect(firstView.grantActive).toBe(true);
    expect(firstView.decision).toMatchObject({
        choice: "always",
        via: "card",
        outcome: { kind: "applied", action: "continue_sources_preparation" },
    });

    const grants = await client(f).query(api.execution.approvals.listGrants, {
        runId: f.runId,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.action).toBe("continue_sources_preparation");

    // Simulate a later time limit in the resumed generation, then raise as system (no browser identity).
    vi.advanceTimersByTime(16 * 60_000);
    const resumedRun = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(resumedRun);
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            generation: resumedRun.executionGeneration,
        }),
    );
    await reachTimeLimit(f);

    const second = await f.t.run(async (ctx) => {
        const requests = await ctx.db
            .query("approvalRequests")
            .withIndex("by_run_action_generation", (q) =>
                q
                    .eq("runId", f.runId)
                    .eq("action", "continue_sources_preparation")
                    .eq(
                        "expectedGeneration",
                        resumedRun.executionGeneration + 1,
                    ),
            )
            .collect();
        expect(requests).toHaveLength(1);
        assert(requests[0]);
        return requests[0];
    });
    expect(second.status).toBe("approved");
    expect(second._id).not.toBe(first.requestId);

    const secondView = await client(f).query(api.execution.approvals.get, {
        requestId: second._id,
    });
    expect(secondView).toMatchObject({
        id: second._id,
        status: "approved",
        grantActive: true,
        decision: {
            choice: "always",
            via: "grant",
            decidedBy: { type: "system" },
            outcome: {
                kind: "applied",
                action: "continue_sources_preparation",
            },
        },
    });

    const afterSecond = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(afterSecond).toMatchObject({
        executionStatus: "running",
        executionGeneration: resumedRun.executionGeneration + 2,
    });
});

test("a superseded request is reported without being written", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const { requestId } = await raiseSourcesTimeLimitApproval(f);
    await f.t.run((ctx) =>
        resumeResearch(ctx, { runId: f.runId, expectedGeneration: 5 }),
    );

    const view = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(view.status).toBe("superseded");
    expect(view.block).toBeNull();

    const stored = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(stored?.status).toBe("pending");
});

test("granting Continue revokes an Always use-what's-prepared grant", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const { requestId } = await raiseSourcesTimeLimitApproval(f);

    await f.t.run((ctx) =>
        ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "settle_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        }),
    );

    const view = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "always",
    });
    expect(view.status).toBe("approved");
    expect(view.grantActive).toBe(true);

    const grants = await client(f).query(api.execution.approvals.listGrants, {
        runId: f.runId,
    });
    expect(grants.map((g) => g.action)).toEqual([
        "continue_sources_preparation",
    ]);

    const settleGrant = await f.t.run((ctx) =>
        activeGrant(ctx, f.runId, "settle_sources_preparation"),
    );
    expect(settleGrant).toBeNull();
});

test("revoking a grant brings the card back", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const first = await raiseSourcesTimeLimitApproval(f);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId: first.requestId,
        choice: "always",
    });

    await client(f).mutation(api.execution.approvals.revokeGrant, {
        runId: f.runId,
        action: "continue_sources_preparation",
    });

    const grants = await client(f).query(api.execution.approvals.listGrants, {
        runId: f.runId,
    });
    expect(grants).toEqual([]);

    vi.advanceTimersByTime(16 * 60_000);
    const resumedRun = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(resumedRun);
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            generation: resumedRun.executionGeneration,
        }),
    );
    await reachTimeLimit(f);

    const second = await raiseSourcesTimeLimitApproval(f);
    expect(second.status).toBe("pending");
});

test("deny on an agent request changes nothing", async () => {
    const f = await seedExpiredPreparation();
    const messageId = await seedAgentMessageId(f);

    const runBefore = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(runBefore);

    const { requestId, status } = await f.t.run((ctx) =>
        raiseApproval(ctx, {
            run: runBefore,
            action: "pause_research",
            requestedBy: {
                type: "agent",
                missionId: f.missionId,
                messageId,
            },
        }),
    );
    expect(status).toBe("pending");

    const view = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "deny",
    });
    expect(view).toMatchObject({
        id: requestId,
        status: "denied",
        decision: {
            choice: "deny",
            via: "card",
            decidedBy: { type: "visitor", visitorId: f.visitorId },
            outcome: { kind: "none" },
        },
    });

    const runAfter = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(runAfter).toEqual(runBefore);
});

test("an agent request answered by a grant on the open request's alternative reports that grant", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const messageId = await seedAgentMessageId(f);
    const { sourcesDecisionRequestId: pendingId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(pendingId);
    await f.t.run((ctx) =>
        ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "settle_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        }),
    );

    const raised = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "settle_sources_preparation",
            requestedBy: { type: "agent", missionId: f.missionId, messageId },
        });
    });
    expect(raised).toEqual({ requestId: pendingId, status: "applied" });

    const view = await client(f).query(api.execution.approvals.get, {
        requestId: pendingId,
    });
    expect(view).toMatchObject({
        status: "approved",
        decision: {
            via: "grant",
            outcome: { kind: "applied", action: "settle_sources_preparation" },
        },
        grantActive: true,
    });
});

test("a request from an earlier generation is superseded and refused", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            agentExecutionVersion: 3,
        }),
    );

    const { requestId } = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return raiseApproval(ctx, {
            run,
            action: "pause_research",
            requestedBy: { type: "system" },
        });
    });

    await client(f).mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 4,
    });

    const error = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(error)).toBe("stale_execution");

    const stored = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(stored?.status).toBe("pending");
    expect(stored?.decision).toBeUndefined();
});

test("deciding again with the same choice returns the recorded decision; another choice is refused", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const { requestId } = await raiseSourcesTimeLimitApproval(f);
    const firstView = await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "once",
    });

    const replayView = await client(f).mutation(
        api.execution.approvals.decide,
        {
            requestId,
            choice: "once",
        },
    );
    expect(replayView).toEqual(firstView);

    const conflictError = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "deny",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(conflictError)).toBe(
        "approval_already_decided",
    );
});

test("an unavailable action stays pending with its reason", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: Date.now(),
        }),
    );

    const { requestId } = await raiseSourcesTimeLimitApproval(f);
    const pendingView = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(pendingView.status).toBe("pending");
    expect(pendingView.block).toBe("paid_work_disabled");

    const blockedError = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(blockedError)).toBe("paid_work_disabled");

    const stillPending = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(stillPending?.status).toBe("pending");

    const settledView = await client(f).mutation(
        api.execution.approvals.decide,
        {
            requestId,
            choice: "alternative",
        },
    );
    expect(settledView.status).toBe("approved");
    expect(settledView.decision?.outcome).toEqual({
        kind: "applied",
        action: "settle_sources_preparation",
    });
});

test("only the dossier owner can decide", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    const { requestId } = await raiseSourcesTimeLimitApproval(f);
    const otherUserId = await f.t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "other-analyst",
            role: "analyst",
            codeDigest: "other-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return userId;
    });

    const otherClient = f.t.withIdentity({ subject: otherUserId });
    await expect(
        otherClient.mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        }),
    ).rejects.toThrow();
    await expect(
        otherClient.query(api.execution.approvals.get, { requestId }),
    ).rejects.toThrow();
    await expect(
        otherClient.query(api.execution.approvals.listGrants, {
            runId: f.runId,
        }),
    ).rejects.toThrow();
    await expect(
        otherClient.mutation(api.execution.approvals.revokeGrant, {
            runId: f.runId,
            action: "continue_sources_preparation",
        }),
    ).rejects.toThrow();
    await expect(
        f.t.mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        }),
    ).rejects.toThrow();
});

test("recordCommandApproval records command decisions and rejects unavailable commands", async () => {
    const f = await seedExpiredPreparation();
    const messageId = await seedAgentMessageId(f);

    // At time limit, resume_research command is blocked by sources_time_limit_decision.
    await reachTimeLimit(f);
    const blockedError = await f.t
        .run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run);
            return recordCommandApproval(ctx, {
                run,
                action: "resume_research",
                requestedBy: {
                    type: "agent",
                    missionId: f.missionId,
                    messageId,
                },
                decidedBy: { type: "visitor", visitorId: f.visitorId },
            });
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(blockedError)).toBe(
        "sources_time_limit_decision",
    );

    const noneRecorded = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", f.runId).eq("status", "approved"),
            )
            .collect(),
    );
    expect(noneRecorded).toEqual([]);

    // On an analyst-paused run within its window, resume_research command applies and records via "command".
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.preparationId, {
            deadlineAt: Date.now() + 60_000,
        });
        await ctx.db.patch(f.runId, {
            executionStatus: "paused",
            pauseReason: "analyst",
        });
    });
    const requestId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return recordCommandApproval(ctx, {
            run,
            action: "resume_research",
            requestedBy: {
                type: "agent",
                missionId: f.missionId,
                messageId,
            },
            decidedBy: { type: "visitor", visitorId: f.visitorId },
        });
    });

    const view = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(view).toMatchObject({
        id: requestId,
        action: "resume_research",
        status: "approved",
        decision: {
            choice: "once",
            via: "command",
            decidedBy: { type: "visitor", visitorId: f.visitorId },
            outcome: { kind: "applied", action: "resume_research" },
        },
    });
});

test("readApprovalFacts, readSourcesDecisionRequestId, and standing grant blocked fallback work together", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    // Grant continue, then disable paid work so standing grant leaves request pending with block.
    await f.t.run(async (ctx) => {
        await ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "continue_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        });
        await ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: Date.now(),
        });
    });

    const raised = await raiseSourcesTimeLimitApproval(f);
    expect(raised.status).toBe("pending");

    const { facts, continueId, viewStatus } = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const req = await ctx.db.get(raised.requestId);
        assert(req);
        return {
            facts: await readApprovalFacts(ctx, run),
            continueId: await readSourcesDecisionRequestId(ctx, run),
            viewStatus: {
                derived: approvalStatus(req, run),
                view: await readApprovalView(ctx, req),
            },
        };
    });

    expect(continueId).toBe(raised.requestId);
    expect(facts).toEqual({
        pending: [
            {
                requestId: raised.requestId,
                action: "continue_sources_preparation",
                alternative: "settle_sources_preparation",
                block: "paid_work_disabled",
            },
        ],
        grants: ["continue_sources_preparation"],
    });
    expect(viewStatus.derived).toBe("pending");
    expect(viewStatus.view.grantActive).toBe(true);
});
