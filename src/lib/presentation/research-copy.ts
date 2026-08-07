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
type ProposalSource = FunctionReturnType<
    typeof api.sourceSelectionProposals.listItemsPage
>["page"][number];
type AuthorityTier = ProposalSource["authorityTier"];
type DocumentKind = ProposalSource["documentKind"];
type SelectionReason = ProposalSource["reasonCodes"][number];
type CoverageRole = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>["coverageGaps"][number];

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : "";
}

function manualSourceErrorCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null || !("data" in error)) {
        return null;
    }
    const data = error.data;
    if (
        typeof data !== "object" ||
        data === null ||
        !("area" in data) ||
        data.area !== "manual_source_intake" ||
        !("code" in data) ||
        typeof data.code !== "string"
    ) {
        return null;
    }
    return data.code;
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
    const code = manualSourceErrorCode(error);
    if (code === "duplicate_source") {
        return "This source is already in this dossier.";
    }
    if (code === "candidate_limit") {
        return "This dossier has reached its source review limit. Review the existing candidates before continuing.";
    }
    if (code === "intake_rate_limited") {
        return "Too many sources were added at once. Wait a moment before trying again.";
    }
    if (code === "preparation_expired") {
        return "This reference expired. Add this source again before starting the dossier.";
    }
    if (code === "dossier_not_accepting_sources") {
        return "This dossier isn't accepting new sources at this stage.";
    }
    if (code === "stale_execution") {
        return "The dossier changed while this source was being added. Refresh and try again.";
    }
    if (code === "not_authenticated" || code === "not_authorized") {
        return "Your access to this dossier could not be verified. Refresh and try again.";
    }
    if (
        code === "invalid_url" ||
        code === "https_required" ||
        code === "credentials_not_allowed" ||
        code === "custom_port_not_allowed" ||
        code === "non_public_destination"
    ) {
        return "Enter a valid public source link beginning with https://.";
    }
    if (code === "not_found" || code === "dns_failed") {
        return "We couldn't find that public source. Check the link and try again.";
    }
    if (code === "access_blocked") {
        return "That source does not allow public access. Try another public link.";
    }
    if (code === "unsupported_content_type") {
        return "That link is not a supported public page or PDF.";
    }
    if (code === "response_too_large") {
        return "That source is too large to inspect in this prototype.";
    }
    if (code === "redirect_limit") {
        return "That link redirects too many times. Use the final public source link.";
    }
    if (
        code === "request_timeout" ||
        code === "connection_failed" ||
        code === "upstream_rate_limited" ||
        code === "upstream_unavailable"
    ) {
        return "That source is temporarily unavailable. Try again.";
    }
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
    exa: "Public web source",
    analyst_url: "Added by analyst",
} satisfies Record<Source["origin"], string>;

const authorityTierLabels = {
    regulator_primary: "Primary regulator",
    company_primary: "Official company source",
    company_hosted_ir: "Qualified investor relations source",
    institutional_independent: "Institutional independent source",
    qualified_partner: "Qualified partner source",
    unverified: "Unverified public source",
    analyst_supplied: "Analyst-supplied source",
} satisfies Record<AuthorityTier, string>;

const documentKindLabels = {
    regulatory_annual: "Annual report",
    regulatory_interim: "Interim report",
    regulatory_material: "Material event filing",
    regulatory_proxy: "Proxy filing",
    regulatory_ownership: "Ownership filing",
    regulatory_registration: "Registration filing",
    regulatory_other: "Other regulatory filing",
    earnings_release: "Earnings results",
    investor_presentation: "Investor presentation",
    earnings_transcript: "Earnings transcript",
    official_product_documentation: "Product documentation",
    official_integration_documentation: "Integration documentation",
    official_pricing: "Pricing",
    official_commercial_terms: "Commercial terms",
    official_security_documentation: "Security documentation",
    independent_analysis: "Independent analysis",
    news_reporting: "News reporting",
    partner_evidence: "Partner evidence",
    community_content: "Community content",
    search_or_index: "Index or search page",
    unknown: "Document type unavailable",
} satisfies Record<DocumentKind, string>;

const selectionReasonLabels = {
    added_by_analyst: "Included because it was added by the analyst",
    required_family_coverage: "Included to cover a required evidence family",
    ranked_fill: "Included to broaden the available source set",
    unrecognized_source_family: "Source family could not be verified",
    not_selected: "Kept available as an alternative",
    required_coverage_role: "Included to cover a required document role",
    additional_coverage: "Included because it adds distinct coverage",
    canonical_duplicate:
        "Excluded because the same canonical source is already represented",
    metadata_duplicate:
        "Excluded because the same document or event is already represented",
    search_or_index:
        "Excluded because index and search pages do not add direct evidence",
    low_information_document:
        "Excluded because this document type has low value for this research angle",
    company_identity_unverified:
        "Excluded because the source could not be matched to the selected company",
    unverified_publisher:
        "Excluded because its authority could not be verified",
    no_new_coverage: "Excluded because it does not add distinct coverage",
    recommendation_ceiling_reached:
        "Kept available after the reliable recommendation ceiling was reached",
    integrity_conflict:
        "Needs attention because identity or provenance could not be reconciled",
} satisfies Record<SelectionReason, string>;

const coverageRoleLabels = {
    regulatory_annual: "Annual regulatory report",
    regulatory_interim: "Interim regulatory report",
    regulatory_material_event: "Material event filing",
    investor_results: "Recent results",
    investor_presentation: "Presentation or transcript",
    official_product_platform: "Product or platform documentation",
    official_product_integration: "Integration or API documentation",
    official_commercial_pricing: "Pricing",
    official_commercial_terms: "Terms or offer details",
    counter_evidence_primary: "First independent counter-evidence source",
    counter_evidence_secondary: "Second independent counter-evidence source",
    official_security_architecture: "Security architecture",
    official_security_trust: "Trust or data protection documentation",
    independent_analysis_primary: "First independent analysis source",
    independent_analysis_secondary: "Second independent analysis source",
} satisfies Record<CoverageRole, string>;

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

export function sourceAuthorityLabel(
    authorityTier: AuthorityTier | undefined,
): string {
    return authorityTier
        ? authorityTierLabels[authorityTier]
        : "Authority not classified";
}

export function sourceDocumentKindLabel(
    documentKind: DocumentKind | undefined,
): string {
    return documentKind
        ? documentKindLabels[documentKind]
        : "Document type not classified";
}

export function sourceSelectionReasonLabel(
    reasonCodes: ReadonlyArray<SelectionReason>,
): string {
    const reason = reasonCodes[0];
    return reason
        ? selectionReasonLabels[reason]
        : "No additional selection explanation is available";
}

export function sourceCoverageRoleLabel(role: CoverageRole): string {
    return coverageRoleLabels[role];
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
