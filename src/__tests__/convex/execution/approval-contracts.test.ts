import type { Id } from "@convex/_generated/dataModel";
import {
    approvalActionCopy,
    approvalDecisionText,
    approvalOutcomeText,
} from "@convex/domain/approvalCopy";
import { auditEventActionValidator } from "@convex/domain/validators";
import {
    type ApprovalAction,
    type ApprovalDecision,
    type ApprovalRequestView,
    approvalActionValidator,
    approvalChoiceValidator,
    approvalDecisionValidator,
    approvalOutcomeValidator,
    approvalRequesterValidator,
    approvalRequestViewValidator,
    approvalStatusValidator,
    storedApprovalStatusValidator,
} from "@convex/execution/approvalContracts";
import { executionTables } from "@convex/execution/schema";
import schema from "@convex/schema";
import { validate } from "convex-helpers/validators";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const ALL_ACTIONS: readonly ApprovalAction[] = [
    "pause_research",
    "resume_research",
    "continue_sources_preparation",
    "settle_sources_preparation",
];

test("approval contract validators enforce allowed actions, statuses, choices, and actors", () => {
    for (const action of ALL_ACTIONS) {
        expect(validate(approvalActionValidator, action)).toBe(true);
    }
    expect(validate(approvalActionValidator, "start_research")).toBe(false);

    for (const status of ["pending", "approved", "denied"] as const) {
        expect(validate(storedApprovalStatusValidator, status)).toBe(true);
        expect(validate(approvalStatusValidator, status)).toBe(true);
    }
    expect(validate(storedApprovalStatusValidator, "superseded")).toBe(false);
    expect(validate(approvalStatusValidator, "superseded")).toBe(true);

    expect(validate(approvalRequesterValidator, { type: "system" })).toBe(true);
    expect(
        validate(approvalRequesterValidator, {
            type: "agent",
            missionId: "mission_1" as Id<"agentMissions">,
            messageId: "msg_1" as Id<"agentMessageDeliveries">,
        }),
    ).toBe(true);
    expect(
        validate(approvalRequesterValidator, {
            type: "agent",
            missionId: "mission_1",
        }),
    ).toBe(false);
    expect(
        validate(approvalRequesterValidator, {
            type: "visitor",
            visitorId: "visitor_1",
        }),
    ).toBe(false);

    for (const choice of ["once", "always", "alternative", "deny"] as const) {
        expect(validate(approvalChoiceValidator, choice)).toBe(true);
    }
    expect(validate(approvalChoiceValidator, "later")).toBe(false);

    expect(
        validate(approvalOutcomeValidator, {
            kind: "applied",
            action: "continue_sources_preparation",
        }),
    ).toBe(true);
    expect(validate(approvalOutcomeValidator, { kind: "none" })).toBe(true);
    expect(
        validate(approvalOutcomeValidator, {
            kind: "applied",
            action: "unknown_action",
        }),
    ).toBe(false);

    const decision: ApprovalDecision = {
        choice: "always",
        via: "card",
        decidedBy: { type: "visitor", visitorId: "visitor_1" },
        decidedAt: 1_700_000_000_000,
        outcome: { kind: "applied", action: "continue_sources_preparation" },
    };
    expect(validate(approvalDecisionValidator, decision)).toBe(true);
    expect(
        validate(approvalDecisionValidator, { ...decision, via: "chat" }),
    ).toBe(false);

    const view: ApprovalRequestView = {
        id: "req_1" as Id<"approvalRequests">,
        runId: "run_1" as Id<"researchRuns">,
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        requestedBy: { type: "system" },
        status: "pending",
        block: null,
        decision: null,
        grantActive: false,
        createdAt: 1_700_000_000_000,
    };
    expect(validate(approvalRequestViewValidator, view)).toBe(true);
    expect(
        validate(approvalRequestViewValidator, {
            ...view,
            status: "superseded",
        }),
    ).toBe(true);
    expect(
        validate(approvalRequestViewValidator, {
            ...view,
            alternative: undefined,
        }),
    ).toBe(false);

    expect(
        validate(auditEventActionValidator, "run_reopened_at_time_limit"),
    ).toBe(true);
    expect(validate(auditEventActionValidator, "not_an_audit_action")).toBe(
        false,
    );
});

test("execution schema persists approvalRequests, approvalGrants, and notice deliveries with their indexes", async () => {
    expect(executionTables.approvalRequests).toBeDefined();
    expect(executionTables.approvalGrants).toBeDefined();

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
        const now = 1_700_000_000_000;
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            executionGeneration: 1,
            lifecycleState: "framing",
            executionStatus: "paused",
            pauseReason: "sources_time_limit",
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        const conversationId = await ctx.db.insert("agentConversations", {
            runId,
            storageRef: "conv_1",
            queuedCount: 0,
            createdAt: now,
        });
        const requestId = await ctx.db.insert("approvalRequests", {
            runId,
            action: "continue_sources_preparation",
            alternative: "settle_sources_preparation",
            requestedBy: { type: "system" },
            expectedGeneration: 1,
            status: "pending",
            createdAt: now,
        });

        const pendingByStatus = await ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "pending"),
            )
            .collect();
        expect(pendingByStatus.map((row) => row._id)).toEqual([requestId]);

        const byIdentity = await ctx.db
            .query("approvalRequests")
            .withIndex("by_run_action_generation", (q) =>
                q
                    .eq("runId", runId)
                    .eq("action", "continue_sources_preparation")
                    .eq("expectedGeneration", 1),
            )
            .unique();
        expect(byIdentity?._id).toBe(requestId);

        const grantId = await ctx.db.insert("approvalGrants", {
            runId,
            action: "continue_sources_preparation",
            grantedBy: { type: "visitor", visitorId: "visitor_1" },
            grantedAt: now,
        });
        const grants = await ctx.db
            .query("approvalGrants")
            .withIndex("by_run_and_action", (q) =>
                q
                    .eq("runId", runId)
                    .eq("action", "continue_sources_preparation"),
            )
            .collect();
        expect(grants.map((row) => row._id)).toEqual([grantId]);

        const confirmationMessageId = await ctx.db.insert(
            "agentMessageDeliveries",
            {
                runId,
                conversationId,
                storageMessageRef: "msg_confirm",
                requestKey: "confirm_1",
                contentHash: "hash_confirm",
                role: "assistant",
                delivery: "reply",
                status: "processed",
                createdAt: now,
            },
        );
        const noticeMessageId = await ctx.db.insert("agentMessageDeliveries", {
            runId,
            conversationId,
            storageMessageRef: "msg_notice",
            requestKey: "notice_1",
            contentHash: "hash_notice",
            role: "assistant",
            delivery: "notice",
            status: "processed",
            approvalRequestId: requestId,
            approvalDecision: {
                requestId,
                confirmationMessageId,
            },
            createdAt: now + 1,
        });
        const noticeDoc = await ctx.db.get(noticeMessageId);
        expect(noticeDoc?.delivery).toBe("notice");
        expect(noticeDoc?.approvalRequestId).toBe(requestId);
        expect(noticeDoc?.approvalDecision).toEqual({
            requestId,
            confirmationMessageId,
        });
    });

    await expect(
        t.run(async (ctx) => {
            const now = 1_700_000_000_000;
            const runId = await ctx.db.insert("researchRuns", {
                purpose: "research",
                executionGeneration: 1,
                lifecycleState: "framing",
                executionStatus: "paused",
                nextEventSequence: 1,
                createdAt: now,
                updatedAt: now,
            });
            await ctx.db.insert("approvalRequests", {
                runId,
                action: "pause_research",
                requestedBy: { type: "system" },
                expectedGeneration: 1,
                // @ts-expect-error "superseded" is derived, never stored.
                status: "superseded",
                createdAt: now,
            });
        }),
    ).rejects.toThrow();
});

test("approval copy provides action data and distinguishes requests from applied effects", () => {
    expect(approvalActionCopy.pause_research.label).toBe("Pause research");
    expect(approvalActionCopy.resume_research.label).toBe("Resume research");
    expect(approvalActionCopy.continue_sources_preparation.label).toBe(
        "Continue preparation",
    );
    expect(approvalActionCopy.settle_sources_preparation.label).toBe(
        "Use what's prepared",
    );

    expect(approvalActionCopy.continue_sources_preparation.systemTitle).toBe(
        "The Sources Agent reached its time limit",
    );
    expect(approvalActionCopy.pause_research.systemTitle).toBeNull();
    expect(approvalActionCopy.resume_research.systemTitle).toBeNull();
    expect(
        approvalActionCopy.settle_sources_preparation.systemTitle,
    ).toBeNull();

    for (const action of ALL_ACTIONS) {
        const entry = approvalActionCopy[action];
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.consequence.length).toBeGreaterThan(0);
        expect(entry.onceLabel.length).toBeGreaterThan(0);
        expect(entry.alwaysLabel.length).toBeGreaterThan(0);
        expect(entry.grantedLabel.length).toBeGreaterThan(0);
    }

    const alwaysDecision: ApprovalDecision = {
        choice: "always",
        via: "card",
        decidedBy: { type: "visitor", visitorId: "visitor_1" },
        decidedAt: 1_700_000_000_000,
        outcome: { kind: "applied", action: "continue_sources_preparation" },
    };
    expect(
        approvalDecisionText("continue_sources_preparation", alwaysDecision),
    ).toBe("Continue preparation: always for this dossier");

    const baseView: ApprovalRequestView = {
        id: "req_1" as Id<"approvalRequests">,
        runId: "run_1" as Id<"researchRuns">,
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        requestedBy: { type: "system" },
        status: "pending",
        block: null,
        decision: null,
        grantActive: false,
        createdAt: 1_700_000_000_000,
    };

    const pendingText = approvalOutcomeText(baseView);
    const supersededText = approvalOutcomeText({
        ...baseView,
        status: "superseded",
    });
    const deniedText = approvalOutcomeText({
        ...baseView,
        status: "denied",
        decision: {
            choice: "deny",
            via: "card",
            decidedBy: { type: "visitor", visitorId: "visitor_1" },
            decidedAt: 1_700_000_000_001,
            outcome: { kind: "none" },
        },
    });
    const approvedNoEffectText = approvalOutcomeText({
        ...baseView,
        status: "approved",
        decision: {
            choice: "once",
            via: "card",
            decidedBy: { type: "visitor", visitorId: "visitor_1" },
            decidedAt: 1_700_000_000_002,
            outcome: { kind: "none" },
        },
    });
    const appliedOnceText = approvalOutcomeText({
        ...baseView,
        status: "approved",
        decision: {
            choice: "once",
            via: "card",
            decidedBy: { type: "visitor", visitorId: "visitor_1" },
            decidedAt: 1_700_000_000_003,
            outcome: {
                kind: "applied",
                action: "continue_sources_preparation",
            },
        },
    });
    const appliedAlternativeText = approvalOutcomeText({
        ...baseView,
        status: "approved",
        decision: {
            choice: "alternative",
            via: "card",
            decidedBy: { type: "visitor", visitorId: "visitor_1" },
            decidedAt: 1_700_000_000_004,
            outcome: { kind: "applied", action: "settle_sources_preparation" },
        },
    });
    const appliedGrantText = approvalOutcomeText({
        ...baseView,
        status: "approved",
        decision: {
            choice: "always",
            via: "grant",
            decidedBy: { type: "system" },
            decidedAt: 1_700_000_000_005,
            outcome: {
                kind: "applied",
                action: "continue_sources_preparation",
            },
        },
    });

    // Pending/superseded/denied/no-op outcomes must never claim an effect was applied.
    for (const nonApplied of [
        pendingText,
        supersededText,
        deniedText,
        approvedNoEffectText,
    ]) {
        expect(nonApplied).not.toMatch(/^Applied\b/i);
    }
    expect(pendingText).toBe("Approval requested: Continue preparation.");
    expect(supersededText).toBe(
        "Superseded: Continue preparation was not applied.",
    );
    expect(deniedText).toBe("Denied: Continue preparation was not applied.");
    expect(approvedNoEffectText).toBe("Approved: no action was applied.");
    expect(appliedOnceText).toBe("Applied: Continue preparation.");
    expect(appliedAlternativeText).toBe("Applied: Use what's prepared.");
    expect(appliedGrantText).toBe(
        "Applied automatically for this dossier: Continue preparation.",
    );

    // No raw internal action keys or schema identifiers leak into analyst-facing copy.
    const allCopy = [
        ...ALL_ACTIONS.flatMap((action) => {
            const c = approvalActionCopy[action];
            return [
                c.label,
                c.consequence,
                c.onceLabel,
                c.alwaysLabel,
                c.grantedLabel,
                c.systemTitle ?? "",
            ];
        }),
        pendingText,
        supersededText,
        deniedText,
        approvedNoEffectText,
        appliedOnceText,
        appliedAlternativeText,
        appliedGrantText,
    ].join("\n");
    for (const rawInternal of [
        "pause_research",
        "resume_research",
        "continue_sources_preparation",
        "settle_sources_preparation",
        "researchRuns",
        "approvalRequests",
        "executionGeneration",
    ]) {
        expect(allCopy).not.toContain(rawInternal);
    }
});
