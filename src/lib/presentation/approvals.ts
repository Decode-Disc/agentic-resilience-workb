import { agentName } from "@convex/domain/agentIdentities";
import {
    approvalActionCopy,
    approvalOutcomeText,
} from "@convex/domain/approvalCopy";
import type {
    ApprovalChoice,
    ApprovalRequestView,
} from "@convex/execution/approvalContracts";
import {
    type ApprovalCardChoice,
    type ApprovalCardState,
    DEFAULT_APPROVAL_CHOICES,
} from "@/components/chat/approval-card";

export const APPROVAL_STALE_COPY =
    "This was already decided. Showing the current state.";

const sourcesAgent = `The ${agentName("sources")}`;

const BLOCK_COPY: Record<string, string> = {
    execution_slot_unavailable:
        "Another of your analyses is running. Continue when it finishes, or use what's prepared now.",
    paid_work_disabled:
        "New research work is temporarily unavailable. You can use what's prepared now.",
    sources_settlement_requested: `You chose to use what's prepared. ${sourcesAgent} is handing off its material.`,
    sources_configuration_unavailable:
        "The research configuration for this step is unavailable. Review your current dossier before trying again.",
    sources_capacity_exhausted:
        "The documentary preparation capacity for this dossier has been reached.",
    sources_time_limit_decision:
        "A preparation decision is required before research can continue.",
    human_prerequisite_required:
        "This dossier is waiting for a decision before it can continue.",
    research_control_not_supported:
        "This research step cannot be controlled from this request.",
    stale_execution:
        "This dossier has moved ahead since this request was created.",
    not_authorized: "You cannot apply this decision on the current dossier.",
    approval_choice_unavailable:
        "That choice is not available for this request.",
    approval_already_decided: APPROVAL_STALE_COPY,
};

/** Translates internal availability and refusal codes into analyst-readable copy. */
export function approvalBlockCopy(code: string): string {
    return (
        BLOCK_COPY[code] ??
        "This action cannot be applied right now. Review the current dossier before trying again."
    );
}

function cardStateForRequest(
    status: ApprovalRequestView["status"],
): ApprovalCardState {
    switch (status) {
        case "pending":
            return "request";
        case "approved":
            return "done";
        case "denied":
            return "denied";
        case "superseded":
            return "superseded";
    }
}

/** Derives neutral ApprovalCard props solely from typed approval copy without action-specific branching. */
export function approvalCardPresentation(view: ApprovalRequestView): {
    title: string;
    description: string;
    details: readonly { label: string; value: string }[];
    state: ApprovalCardState;
    statusLabel?: string;
    choices: ApprovalCardChoice<ApprovalChoice>[];
} {
    const actionCopy = approvalActionCopy[view.action];
    const alternativeCopy = view.alternative
        ? approvalActionCopy[view.alternative]
        : null;
    const state = cardStateForRequest(view.status);
    const disabledReason =
        view.status === "pending" && view.block
            ? approvalBlockCopy(view.block)
            : undefined;

    const title = alternativeCopy
        ? (actionCopy.systemTitle ?? actionCopy.label)
        : actionCopy.label;
    const description = alternativeCopy
        ? `${actionCopy.consequence} ${alternativeCopy.consequence}`
        : actionCopy.consequence;

    const choices: ApprovalCardChoice<ApprovalChoice>[] =
        view.status !== "pending"
            ? []
            : alternativeCopy
              ? [
                    {
                        value: "alternative",
                        label: alternativeCopy.label,
                        variant: "outline",
                    },
                    {
                        value: "once",
                        label: actionCopy.onceLabel,
                        variant: "outline",
                        ...(disabledReason ? { disabledReason } : {}),
                    },
                    {
                        value: "always",
                        label: actionCopy.alwaysLabel,
                        variant: "default",
                        ...(disabledReason ? { disabledReason } : {}),
                    },
                ]
              : DEFAULT_APPROVAL_CHOICES.map((choice) =>
                    choice.value !== "deny" && disabledReason
                        ? { ...choice, disabledReason }
                        : { ...choice },
                );

    return {
        title,
        description,
        details: [],
        state,
        ...(view.status !== "pending"
            ? { statusLabel: approvalOutcomeText(view) }
            : {}),
        choices,
    };
}
