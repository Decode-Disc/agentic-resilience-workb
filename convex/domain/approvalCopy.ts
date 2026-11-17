import { agentName } from "@convex/domain/agentIdentities";
import type {
    ApprovalAction,
    ApprovalDecision,
    ApprovalRequestView,
} from "@convex/execution/approvalContracts";

export type ApprovalActionCopy = {
    label: string;
    consequence: string;
    onceLabel: string;
    alwaysLabel: string;
    grantedLabel: string;
    /** System notice title, also used by cards presenting alternative actions. */
    systemTitle: string | null;
};

/** Card and receipt wording for every typed approval action; consumers never branch on action ids. */
export const approvalActionCopy: Record<ApprovalAction, ApprovalActionCopy> = {
    pause_research: {
        label: "Pause research",
        consequence:
            "Suspends research progression after any in-flight step settles while keeping the conversation open.",
        onceLabel: "Pause once",
        alwaysLabel: "Always pause",
        grantedLabel: "Pause research automatically",
        systemTitle: null,
    },
    resume_research: {
        label: "Resume research",
        consequence:
            "Continues paused research from the saved state while preserving prior decisions.",
        onceLabel: "Resume once",
        alwaysLabel: "Always resume",
        grantedLabel: "Resume research automatically",
        systemTitle: null,
    },
    continue_sources_preparation: {
        label: "Continue preparation",
        consequence:
            "Keeps gathering sources in another preparation window, using more of this dossier's research capacity.",
        onceLabel: "Continue once",
        alwaysLabel: "Always continue",
        grantedLabel: "Continue preparation automatically",
        systemTitle: `The ${agentName("sources")} reached its time limit`,
    },
    settle_sources_preparation: {
        label: "Use what's prepared",
        consequence:
            "Finishes preparation with the sources already captured and records what it did not cover.",
        onceLabel: "Use once",
        alwaysLabel: "Always use what's prepared",
        grantedLabel: "Use what's prepared automatically",
        systemTitle: `The ${agentName("sources")} needs a decision`,
    },
};

/** Formats the recorded human or standing decision separately from whether an effect ran. */
export function approvalDecisionText(
    action: ApprovalAction,
    decision: ApprovalDecision,
): string {
    const label = approvalActionCopy[action].label;
    switch (decision.choice) {
        case "always":
            return `${decision.outcome.kind === "applied" ? approvalActionCopy[decision.outcome.action].label : label}: always for this dossier`;
        case "once":
            return `${label}: once`;
        case "alternative":
            return decision.outcome.kind === "applied"
                ? `${label}: chose ${approvalActionCopy[decision.outcome.action].label}`
                : `${label}: chose alternative`;
        case "deny":
            return `${label}: denied`;
    }
}

/** Formats an approval request's current state, distinguishing pending/non-applied requests from applied effects. */
export function approvalOutcomeText(view: ApprovalRequestView): string {
    const label = approvalActionCopy[view.action].label;
    switch (view.status) {
        case "pending":
            return `Approval requested: ${label}.`;
        case "superseded":
            return `Superseded: ${label} was not applied.`;
        case "denied":
            return `Denied: ${label} was not applied.`;
        case "approved": {
            if (view.decision?.outcome.kind === "applied") {
                const appliedLabel =
                    approvalActionCopy[view.decision.outcome.action].label;
                return view.decision.via === "grant"
                    ? `Applied automatically for this dossier: ${appliedLabel}.`
                    : `Applied: ${appliedLabel}.`;
            }
            return "Approved: no action was applied.";
        }
    }
}

function lowerFirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The conversation notice for a request the system raised: what happened, then the choice or what a standing permission applied. */
export function approvalNoticeText(view: ApprovalRequestView): string {
    const copy = approvalActionCopy[view.action];
    const title = copy.systemTitle ?? copy.label;
    if (view.status !== "pending")
        return `${title}. ${approvalOutcomeText(view)}`;
    return view.alternative
        ? `${title}. Choose whether to ${lowerFirst(copy.label)} or ${lowerFirst(approvalActionCopy[view.alternative].label)}.`
        : `${title}. ${approvalOutcomeText(view)}`;
}
