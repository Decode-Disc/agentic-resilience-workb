import type { Id } from "@convex/_generated/dataModel";
import { approvalActionCopy } from "@convex/domain/approvalCopy";
import type {
    ApprovalAction,
    ApprovalRequestView,
} from "@convex/execution/approvalContracts";
import { expect, test } from "vitest";
import {
    APPROVAL_STALE_COPY,
    approvalBlockCopy,
    approvalCardPresentation,
} from "@/lib/presentation/approvals";

const ALL_ACTIONS: readonly ApprovalAction[] = [
    "pause_research",
    "resume_research",
    "continue_sources_preparation",
    "settle_sources_preparation",
];

const ALL_BLOCKS = [
    "execution_slot_unavailable",
    "paid_work_disabled",
    "sources_settlement_requested",
    "sources_configuration_unavailable",
    "sources_capacity_exhausted",
    "sources_time_limit_decision",
    "human_prerequisite_required",
    "action_not_applicable",
    "research_control_not_supported",
    "stale_execution",
    "not_authorized",
    "approval_choice_unavailable",
    "approval_already_decided",
] as const;

const RAW_PATTERN =
    /pause_research|resume_research|continue_sources_preparation|settle_sources_preparation|execution_slot_unavailable|paid_work_disabled|sources_settlement_requested|sources_configuration_unavailable|sources_capacity_exhausted|sources_time_limit_decision|human_prerequisite_required|action_not_applicable|research_control_not_supported|stale_execution|not_authorized|approval_|sources_time_limit/;

function makeView(
    overrides: Partial<ApprovalRequestView> = {},
): ApprovalRequestView {
    return {
        id: "req_1" as Id<"approvalRequests">,
        runId: "run_1" as Id<"researchRuns">,
        action: "pause_research",
        alternative: null,
        requestedBy: { type: "system" },
        status: "pending",
        block: null,
        decision: null,
        grantActive: false,
        createdAt: 1,
        ...overrides,
    };
}

test("the time-limit request names both options in the agreed order", () => {
    const view = makeView({
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        block: "execution_slot_unavailable",
    });
    const presentation = approvalCardPresentation(view);
    expect(presentation.title).toBe(
        approvalActionCopy.continue_sources_preparation.systemTitle,
    );
    expect(presentation.state).toBe("request");
    expect(presentation.choices).toHaveLength(3);
    expect(
        presentation.choices.map((c) => [c.value, c.label, c.variant]),
    ).toEqual([
        ["alternative", "Use what's prepared", "outline"],
        ["once", "Continue once", "outline"],
        ["always", "Always continue", "outline"],
    ]);
    expect(presentation.choices[0]?.disabledReason).toBeUndefined();
    expect(presentation.choices[1]?.disabledReason).toBeTruthy();
    expect(presentation.choices[2]?.disabledReason).toBeTruthy();
});

test("approval copy never shows raw codes", () => {
    for (const code of ALL_BLOCKS) {
        const copy = approvalBlockCopy(code);
        expect(copy.length).toBeGreaterThan(0);
        expect(copy).not.toMatch(RAW_PATTERN);
    }
    expect(APPROVAL_STALE_COPY).not.toMatch(RAW_PATTERN);

    for (const action of ALL_ACTIONS) {
        for (const status of [
            "pending",
            "approved",
            "denied",
            "superseded",
        ] as const) {
            const view = makeView({
                action,
                status,
                block:
                    status === "pending" ? "execution_slot_unavailable" : null,
                decision:
                    status === "approved"
                        ? {
                              choice: "once",
                              via: "card",
                              decidedBy: { type: "system" },
                              decidedAt: 2,
                              outcome: { kind: "applied", action },
                          }
                        : status === "denied"
                          ? {
                                choice: "deny",
                                via: "card",
                                decidedBy: { type: "system" },
                                decidedAt: 2,
                                outcome: { kind: "none" },
                            }
                          : null,
            });
            const p = approvalCardPresentation(view);
            expect(p.title).not.toMatch(RAW_PATTERN);
            expect(p.description ?? "").not.toMatch(RAW_PATTERN);
            expect(p.statusLabel ?? "").not.toMatch(RAW_PATTERN);
            for (const c of p.choices) {
                expect(c.label).not.toMatch(RAW_PATTERN);
                expect(c.disabledReason ?? "").not.toMatch(RAW_PATTERN);
            }
        }
    }
});

test("decision feedback distinguishes an inapplicable action from a stale decision", async () => {
    const { approvalDecisionFeedback } = await import(
        "@/lib/presentation/approvals"
    );
    expect(approvalDecisionFeedback("action_not_applicable")).toBe(
        approvalBlockCopy("action_not_applicable"),
    );
    expect(approvalDecisionFeedback("action_not_applicable")).not.toBe(
        APPROVAL_STALE_COPY,
    );
    for (const code of [
        "approval_already_decided",
        "stale_execution",
        "human_prerequisite_required",
    ])
        expect(approvalDecisionFeedback(code)).toBe(APPROVAL_STALE_COPY);
    expect(approvalDecisionFeedback(null)).not.toMatch(RAW_PATTERN);
    expect(approvalDecisionFeedback(null)).toBe(
        "This decision could not be recorded right now. Try again.",
    );
    expect(approvalDecisionFeedback("execution_slot_unavailable")).toBe(
        approvalBlockCopy("execution_slot_unavailable"),
    );
});
