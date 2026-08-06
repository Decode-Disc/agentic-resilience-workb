import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type RunProjection = NonNullable<
    FunctionReturnType<typeof api.researchRuns.getMine>
>;
type LifecycleState = RunProjection["lifecycleState"];
type ExecutionStatus = RunProjection["executionStatus"];
type RunEvent = FunctionReturnType<
    typeof api.researchRuns.listMyEvents
>[number];
type Source = FunctionReturnType<
    typeof api.sources.listForReviewPage
>["page"][number];

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : "";
}

/**
 * Converts access-code failures into the limited information a visitor needs.
 */
export function accessCodeErrorMessage(error: unknown): string {
    const message = errorText(error);
    if (message.includes("Too many access code attempts")) {
        return "Too many attempts. Please wait before trying again.";
    }
    if (message.includes("Access code is not available")) {
        return "That access code is invalid or no longer available.";
    }
    return "We couldn't verify that access code. Try again.";
}

/** Keeps company-resolution failures useful without exposing backend details. */
export function companyLookupErrorMessage(error: unknown): string {
    if (errorText(error).includes("Company could not be resolved")) {
        return "We couldn't find an exact public company match. Try its current name or ticker.";
    }
    return "We couldn't verify that company. Try again.";
}

/** Translates source intake failures without exposing backend configuration. */
export function sourceAddErrorMessage(error: unknown): string {
    if (errorText(error).includes("source candidate limit")) {
        return "This dossier has reached its source review limit. Review the existing candidates before continuing.";
    }
    return "We couldn't add that source. Try again.";
}

const lifecycleLabels = {
    draft: "Preparing research",
    checking_public_evidence: "Checking public evidence",
    awaiting_evidence_sufficiency_review: "Review evidence coverage",
    discovering_sources: "Gathering public sources",
    awaiting_source_review: "Review source set",
    corpus_approved: "Source set approved",
    extracting_evidence: "Reviewing evidence passages",
    assessing_dimensions: "Preparing dimension assessments",
    awaiting_assessment_review: "Review dimension assessments",
    completed: "Research dossier complete",
} satisfies Record<LifecycleState, string>;

const executionLabels = {
    idle: "Ready",
    running: "In progress",
    paused: "Waiting for review",
    failed: "Needs attention",
    cancelled: "Stopped",
    completed: "Complete",
} satisfies Record<ExecutionStatus, string>;

const eventLabels = {
    run_created: "Research dossier created",
    run_transitioned: "Research advanced",
    run_failed: "Research needs attention",
    run_cancelled: "Research stopped",
    run_retried: "Research resumed",
    company_confirmed: "Company confirmed",
    evidence_sufficiency_evaluated: "Evidence coverage checked",
    research_plan_created: "Research focus prepared",
    source_discovery_progress: "Public sources reviewed",
    corpus_revision_approved: "Source set approved",
} satisfies Record<RunEvent["type"], string>;

const sourceOriginLabels = {
    sec: "SEC filing",
    exa: "Independent web source",
    analyst_url: "Added by analyst",
} satisfies Record<Source["origin"], string>;

const sourceDecisionLabels = {
    accepted: "Accepted",
    rejected: "Rejected",
    pending: "Pending review",
} satisfies Record<Source["decision"], string>;

/** Returns an analyst-readable stage label for a persisted lifecycle value. */
export function lifecycleLabel(state: LifecycleState): string {
    return lifecycleLabels[state];
}

/** Returns an analyst-readable execution label. */
export function executionLabel(status: ExecutionStatus): string {
    return executionLabels[status];
}

/** Returns a stable milestone label without exposing event keys. */
export function eventLabel(type: RunEvent["type"]): string {
    return eventLabels[type];
}

/** Translates source provenance codes at the analyst presentation boundary. */
export function sourceOriginLabel(origin: Source["origin"]): string {
    return sourceOriginLabels[origin];
}

/** Translates persisted source decisions for display. */
export function sourceDecisionLabel(decision: Source["decision"]): string {
    return sourceDecisionLabels[decision];
}

/** Makes source-plan categories readable without exposing storage tokens. */
export function sourceCategoryLabel(category: string): string {
    return category
        .split("_")
        .filter(Boolean)
        .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
        .join(" ");
}

const providerServiceLabels: Record<string, string> = {
    sec: "SEC public filings",
    exa: "Independent web discovery",
    url_metadata: "Public URL inspection",
};

const providerStatusLabels: Record<string, string> = {
    started: "In progress",
    succeeded: "Completed",
    partial: "Completed with rejected results",
    failed: "Failed",
};

const providerOperationLabels: Record<string, string> = {
    resolve_company: "Company lookup",
    revalidate_company: "Company verification",
    resolve_company_website: "Company website lookup",
    search: "Search",
    inspect_launch_manual_source: "Reference inspection",
};

const providerErrorLabels: Record<string, string> = {
    exa_not_configured: "Configuration missing",
    invalid_provider_response: "Provider response rejected",
    stale_execution: "Result arrived after the run stopped",
    ExaLogicalTimeoutError: "Provider timed out",
    WebsiteResolutionTimeoutError: "Website lookup timed out",
    SecTimeoutError: "SEC request timed out",
};

export function providerServiceLabel(service: string): string {
    return providerServiceLabels[service] ?? "External provider";
}

export function providerStatusLabel(status: string): string {
    return providerStatusLabels[status] ?? "Unknown status";
}

export function providerOperationLabel(operation: string): string {
    return providerOperationLabels[operation] ?? "Provider operation";
}

export function providerErrorLabel(errorCode: string): string {
    return providerErrorLabels[errorCode] ?? "Provider attempt needs review";
}
