import type { api } from "@convex/_generated/api";
import { dimensionLabel as domainDimensionLabel } from "@convex/domain/researchPlan";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

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
type CompanyLinkageBasis = ProposalSource["companyLinkageBasis"];
type SelectionReason = ProposalSource["reasonCodes"][number];
type ProposalSummary = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>;
type CoverageRole = ProposalSummary["coverageGaps"][number];
type ReviewSource = NonNullable<
    FunctionReturnType<typeof api.sources.getReviewSource>
>;
type SourceQualification = NonNullable<ReviewSource["qualification"]>;

export type SourceRecoveryState = {
    target: FunctionArgs<
        typeof api.sourceSelectionProposalActions.recoverDiscovery
    >["target"];
    feedback: ReturnType<typeof sourceRecoveryFeedback> | null;
    retryAfterSeconds: number;
};

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
    evidence_ready: "Evidence ready for assessment",
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

// Tailwind resolves utilities from literal source text, so these class names
// are written out in full. Composing them from a color name at runtime emits
// classes that never reach the stylesheet.
const executionStatusTones = {
    idle: "bg-secondary text-secondary-foreground ring-secondary/25",
    running: "bg-info text-info-foreground ring-info/25",
    paused: "bg-warning text-warning-foreground ring-warning/25",
    failed: "bg-danger text-danger-foreground ring-danger/25",
    cancelled: "bg-muted text-muted-foreground ring-muted/25",
    completed: "bg-success text-success-foreground ring-success/25",
} satisfies Record<ExecutionStatus, string>;

const executionStatusEdges = {
    idle: "text-secondary",
    running: "text-info",
    paused: "text-warning",
    failed: "text-danger",
    cancelled: "text-muted",
    completed: "text-success",
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
    source_recovery_started: "Searching for additional sources",
    source_recovery_completed: "Source search finished",
    source_preparation_progress: "Sources checked",
    source_preparation_completed: "Source checks finished",
    corpus_revision_approved: "Source set approved",
    corpus_revision_started: "New source revision started",
    evidence_source_progress: "Evidence source reviewed",
    claim_generation_paused: "Claim generation paused",
    evidence_ready: "Evidence ready",
} satisfies Record<RunEvent["type"], string>;

const sourceOriginLabels = {
    sec: "SEC filing",
    exa: "Public web source",
    analyst_url: "Added by analyst",
} satisfies Record<Source["origin"], string>;

const authorityTierPresentation = {
    regulator_primary: {
        label: "SEC-hosted source",
        description:
            "This address is hosted on sec.gov. Hosting alone does not establish authorship, filing status, or verification of its contents.",
        className: "text-info-foreground dark:text-info",
    },
    company_primary: {
        label: "Official company source",
        description:
            "The address matches an identified company website or investor relations domain. This does not independently verify the document's assertions.",
        className: "text-info-foreground dark:text-info",
    },
    company_hosted_ir: {
        label: "Investor relations host",
        description:
            "The address uses a recognized investor relations host. Company linkage and document content are assessed separately.",
        className: "text-brand-purple",
    },
    institutional_independent: {
        label: "Institutional publisher",
        description:
            "The publisher is recognized in the source registry. This alone does not establish independent corroboration or verify its assertions.",
        className: "text-brand-purple",
    },
    qualified_partner: {
        label: "Partner source",
        description:
            "The address matches a recognized partner publisher. It does not establish first-party evidence for the company.",
        className: "text-brand-purple",
    },
    unverified: {
        label: "Unverified public source",
        description:
            "The publisher's authority has not been established. Review the source and its use restrictions before relying on it.",
        className: "text-warning-foreground dark:text-warning",
    },
    analyst_supplied: {
        label: "Analyst-supplied source",
        description:
            "The source was supplied by the analyst. This does not establish its publisher's authority or documentary contribution.",
        className: "text-muted-foreground",
    },
} satisfies Record<
    AuthorityTier,
    { label: string; description: string; className: string }
>;

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
    unverified_counter_evidence: "Unverified counter-evidence",
    unknown: "Document type unavailable",
} satisfies Record<DocumentKind, string>;

const selectionReasonLabels = {
    added_by_analyst: "Included because it was added by the analyst",
    required_family_coverage: "Included to cover a required evidence family",
    ranked_fill: "Recommended as supplementary material",
    unrecognized_source_family: "Source family could not be verified",
    not_selected: "Kept available as an alternative",
    required_coverage_role: "Included to cover a required document role",
    additional_coverage:
        "Recommended for additional material; documentary coverage is assessed separately",
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
    unverified_counter_evidence:
        "Available for manual review as unverified counter-evidence",
    qualified_partner_manual_review:
        "Available for manual review as qualified partner material",
    no_new_coverage: "Excluded because it does not add distinct coverage",
    recommendation_ceiling_reached:
        "Kept available after the reliable recommendation ceiling was reached",
    targeted_search_review:
        "Found in a targeted search. Review before including",
    integrity_conflict:
        "Needs attention because identity or provenance could not be reconciled",
} satisfies Record<SelectionReason, string>;

const coverageRoleLabels = {
    regulatory_annual: "Annual regulatory report",
    regulatory_interim: "Interim regulatory report",
    regulatory_material_event: "Material event filing",
    investor_results: "Recent results",
    investor_presentation: "Presentation or transcript",
    official_product_platform: "Product documentation",
    official_product_integration: "APIs & integrations",
    official_commercial_pricing: "Pricing",
    official_commercial_terms: "Subscription & service terms",
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

/**
 * Returns Tailwind surface-tint classes (bg, text, ring) for an execution
 * status, so a badge or pin can carry the status's semantic tone without
 * hardcoding colors at each call site.
 */
export function executionStatusTone(status: ExecutionStatus): string {
    return executionStatusTones[status];
}

/**
 * Returns the text-color class that paints a shape bleeding out of a tinted
 * surface, such as the cutout corners beside a status pin. It matches the fill
 * that `executionStatusTone` applies as a background.
 */
export function executionStatusEdgeClass(status: ExecutionStatus): string {
    return executionStatusEdges[status];
}

/** Returns a stable milestone label without exposing event keys. */
export function eventLabel(type: RunEvent["type"]): string {
    return eventLabels[type];
}

/** Translates source provenance codes at the analyst presentation boundary. */
export function sourceOriginLabel(origin: Source["origin"]): string {
    return sourceOriginLabels[origin];
}

export function sourceInclusionLabel(included: boolean): string {
    return included ? "Included" : "Not included";
}

/** Keeps provenance labels and category colors consistent without implying factual verification. */
export function sourceAuthorityPresentation(
    authorityTier: AuthorityTier | undefined,
) {
    return authorityTier
        ? authorityTierPresentation[authorityTier]
        : {
              label: "Provenance not classified",
              description:
                  "No provenance classification is available for this source.",
              className: "text-muted-foreground",
          };
}

export function sourceDocumentKindLabel(
    documentKind: DocumentKind | undefined,
): string {
    return documentKind
        ? documentKindLabels[documentKind]
        : "Document type not classified";
}

/** Matches the shared source text without changing each view's collection or filters. */
export function sourceMatchesSearch(
    source: Pick<ReviewSource, "title" | "canonicalUrl"> &
        Partial<Pick<ReviewSource, "documentKind">>,
    query: string,
): boolean {
    return `${source.title} ${source.canonicalUrl} ${sourceDocumentKindLabel(source.documentKind)}`
        .toLocaleLowerCase("en")
        .includes(query.trim().toLocaleLowerCase("en"));
}

export function sourceSelectionReasonLabel(
    reasonCodes: ReadonlyArray<SelectionReason>,
): string {
    const reason = reasonCodes[0];
    return reason
        ? selectionReasonLabels[reason]
        : "No additional selection explanation is available";
}

/** Explains the saved selection witness separately from the source's assessed contribution. */
export function sourceSelectionExplanation(
    source: Pick<
        ProposalSource,
        | "selectionRationale"
        | "reasonCodes"
        | "documentKind"
        | "roleAvailability"
        | "inspectionStatus"
        | "disposition"
    >,
) {
    const rationale = source.selectionRationale;
    let reason = sourceSelectionReasonLabel(source.reasonCodes);
    if (rationale?.trigger === "analyst_reference")
        reason = "Added by the analyst.";
    else if (rationale?.trigger === "required_role" && rationale.role)
        reason = `Selected for ${sourceCoverageRoleLabel(rationale.role).toLowerCase()}.`;
    else if (rationale?.trigger === "distinct_contribution") {
        const contentRoles = [
            ...new Set(
                rationale.contributions
                    .filter((item) => item.basis === "inspected_content")
                    .flatMap((item) =>
                        item.role
                            ? [sourceCoverageRoleLabel(item.role).toLowerCase()]
                            : [],
                    ),
            ),
        ];
        if (contentRoles.length)
            reason = `Selected for additional material on ${contentRoles.join(", ")}.`;
        else if (
            rationale.contributions.some(
                (item) =>
                    item.kind === "report_candidate" && item.reportingPeriodEnd,
            )
        )
            reason =
                "Selected for a reporting period not represented when this source was selected.";
        else if (
            rationale.contributions.some(
                (item) => item.kind === "filing_candidate",
            )
        )
            reason =
                "Selected as an additional material-event filing candidate.";
        else if (
            rationale.contributions.some((item) => item.kind === "publisher")
        )
            reason = "Selected for material from an additional publisher.";
        else
            reason = `Selected as an additional ${source.documentKind === "unknown" ? "document" : sourceDocumentKindLabel(source.documentKind).toLowerCase()} candidate.`;
        if (
            !rationale.contributions.some(
                (item) => item.basis === "inspected_content",
            )
        )
            reason += " Selection is based on discovery details.";
    }
    const useful =
        source.roleAvailability?.filter(
            (item) => item.state !== "not_established",
        ) ?? [];
    const available = useful
        .filter((item) => item.state === "available")
        .map((item) => sourceCoverageRoleLabel(item.role).toLowerCase());
    const limited = useful
        .filter((item) => item.state === "limited")
        .map((item) => sourceCoverageRoleLabel(item.role).toLowerCase());
    const assessment =
        source.inspectionStatus === "unavailable"
            ? "Its documentary contribution could not be assessed."
            : !source.inspectionStatus
              ? "Its documentary contribution has not yet been assessed."
              : useful.length === 0
                ? "No documentary contribution has been established from the reviewed material."
                : [
                      available.length
                          ? `Documentary contribution: ${available.join(", ")}.`
                          : "",
                      limited.length
                          ? `Limited contribution: ${limited.join(", ")}.`
                          : "",
                  ]
                      .filter(Boolean)
                      .join(" ");
    const limitations = [
        ...new Set(
            useful.flatMap((item) =>
                item.reasonCodes.map((code) => {
                    if (Object.hasOwn(readingConcernLabels, code))
                        return readingConcernLabels[
                            code as keyof typeof readingConcernLabels
                        ];
                    return "Review the source details for the restrictions on this contribution.";
                }),
            ),
        ),
    ];
    if (
        useful.some((item) => item.usage !== "documentary") &&
        limitations.length === 0
    )
        limitations.push(
            "Review the source details for the restrictions on this contribution.",
        );
    for (const item of useful) {
        if (item.usage === "attributed_argument_only")
            limitations.push(
                "Use only as an attributed argument, not as an established fact.",
            );
        if (item.usage === "verification_required")
            limitations.push("Verify this contribution before relying on it.");
        if (item.usage === "blocked")
            limitations.push("This contribution is not available for use.");
        if (
            item.usage === "historical_only" &&
            !item.reasonCodes.includes("historical")
        )
            limitations.push(readingConcernLabels.historical);
    }
    if (source.inspectionStatus === "partial")
        limitations.push(readingConcernLabels.partial_reading);
    return {
        reason,
        assessment,
        limitations: [...new Set(limitations)],
        missingRationale: !rationale && source.disposition === "recommended",
    };
}

/** Explains discovery-only linkage without implying that source content was verified. */
export function sourceCompanyLinkageLabel(
    companyLinkageBasis: CompanyLinkageBasis,
    inspectionStatus?: ReviewSource["inspectionStatus"],
): string | null {
    return companyLinkageBasis === "discovery_metadata"
        ? inspectionStatus === "complete" || inspectionStatus === "partial"
            ? "Linked from search details; source content was read separately"
            : "Linked from discovery metadata; source content has not been read"
        : null;
}

export function sourceCoverageRoleLabel(role: CoverageRole): string {
    return coverageRoleLabels[role];
}

/** Shared labels and definitions for topic statuses and the Coverage glossary. */
export const sourceCoverageStatusHelp = {
    not_assessed: {
        label: "Not assessed",
        description:
            "Matching sources are included, but their content has not yet been assessed. This is not a finding that evidence is missing.",
    },
    available: {
        label: "Sources available",
        description:
            "The included sources can contribute material for this topic.",
    },
    limited: {
        label: "Limited",
        description:
            "Some material is available, with a limitation that still matters.",
    },
    not_established: {
        label: "Not established",
        description:
            "The included sources have not established this topic. Included matches can still need review.",
    },
} as const;

/** Describes documentary sufficiency separately from inclusion and search activity. */
export function sourceCoverageCopy(
    requirement: ProposalSummary["coverageRequirements"][number],
) {
    if (
        requirement.assessmentStatus === "pending" &&
        requirement.availability !== "limited" &&
        !requirement.covered
    )
        return {
            availability: "not_assessed" as const,
            label: "Not assessed",
            limitation: undefined,
            description:
                "Matching sources are included, but their content has not been assessed. Inclusion alone does not establish coverage.",
        };
    const availability =
        requirement.availability ??
        (requirement.covered ? "available" : "not_established");
    const reasons = requirement.reasonCodes ?? [];
    const readingConcern = (
        [
            "historical",
            "partial_reading",
            "publisher_unverified",
            "period_unestablished",
            "unverified_assertion",
        ] as const
    ).find((reason) => reasons.includes(reason));
    const limitation = readingConcern
        ? sourceReadingConcernCopy(readingConcern)
        : reasons.includes("no_relevant_material")
          ? "The reviewed material did not establish this topic."
          : reasons.includes("company_not_established")
            ? "The material has not been confirmed to concern this company."
            : reasons.includes("analyst_exclusion")
              ? "Some matching sources were excluded from the proposed corpus."
              : undefined;
    if (availability === "available")
        return {
            availability,
            limitation,
            label: sourceCoverageStatusHelp.available.label,
            description:
                "Included sources provide material for this documentary need.",
        };
    if (availability === "limited")
        return {
            availability,
            limitation,
            label: sourceCoverageStatusHelp.limited.label,
            description:
                limitation ??
                "Included material covers only part of this topic.",
        };
    return {
        availability,
        limitation,
        label: sourceCoverageStatusHelp.not_established.label,
        description:
            limitation ??
            ((requirement.includedSourceIds?.length ?? 0) > 0
                ? "No suitable document has been confirmed among the included matches."
                : "No suitable source is included yet."),
    };
}

/** Summarizes the same documentary statuses used by the individual coverage topics. */
export function sourceCoverageSummary(
    requirements: ReadonlyArray<
        ProposalSummary["coverageRequirements"][number]
    >,
) {
    if (requirements.length === 0) return "Coverage not assessed";
    const counts = {
        available: 0,
        limited: 0,
        not_established: 0,
        not_assessed: 0,
    };
    for (const requirement of requirements)
        counts[sourceCoverageCopy(requirement).availability] += 1;
    const gaps = (["not_assessed", "limited", "not_established"] as const)
        .filter((status) => counts[status] > 0)
        .map(
            (status) =>
                `${counts[status]} ${sourceCoverageStatusHelp[status].label.toLocaleLowerCase("en")}`,
        );
    return gaps.length > 0
        ? gaps.join(" · ")
        : "All topics have sources available";
}

/** Keeps dossier-wide search availability separate from feedback for an individual topic. */
export function sourceCoverageSearchState({
    role,
    recovery,
    isSearching = false,
    disabled = false,
    allowanceFeedback,
}: {
    role: CoverageRole;
    recovery?: SourceRecoveryState;
    isSearching?: boolean;
    disabled?: boolean;
    allowanceFeedback?: ReturnType<typeof sourceRecoveryFeedback> | null;
}) {
    const matching =
        recovery?.target.kind === "coverage" && recovery.target.role === role;
    const resultFeedback = matching ? recovery?.feedback : undefined;
    const searching = isSearching && matching;
    const retryAfterSeconds = Math.max(0, recovery?.retryAfterSeconds ?? 0);
    const label = searching
        ? "Searching…"
        : retryAfterSeconds > 0
          ? `Retry in ${retryAfterSeconds}s`
          : "Find more sources";
    return {
        feedback:
            resultFeedback ??
            allowanceFeedback ??
            ((disabled || isSearching) && !searching
                ? {
                      status: "warning" as const,
                      title: "Search paused",
                      description: isSearching
                          ? "Another source search is running. Review existing candidates while it finishes."
                          : "Wait for source preparation to finish, or refresh an outdated proposal before searching. Your current sources are preserved.",
                  }
                : undefined),
        availabilityFeedback: resultFeedback ? allowanceFeedback : undefined,
        searching,
        retryAfterSeconds,
        disabled: disabled || isSearching || retryAfterSeconds > 0,
        label,
        ariaLabel: `${searching ? "Searching sources" : retryAfterSeconds > 0 ? label : "Search sources"} for ${sourceCoverageRoleLabel(role)}`,
    };
}

/** Presents server-owned search limits without exposing configuration or provider diagnostics. */
export function sourceSearchAllowanceCopy(
    allowance: ProposalSummary["searchAllowance"],
) {
    if (!allowance) return null;
    if (!allowance.enabled)
        return {
            status: "danger" as const,
            title: "Search unavailable",
            description:
                "Review existing candidates or add a public source link.",
        };
    if (
        allowance.remainingSearches === 0 ||
        allowance.remainingCandidates === 0
    )
        return {
            status: "warning" as const,
            title: "Search limit reached",
            description:
                "No more searches are available for this dossier. Review existing candidates or add a source link when available.",
        };
    return null;
}

/** Reports persisted preparation outcomes without exposing execution or provider details. */
export function sourcePreparationCopy(
    preparation: NonNullable<ProposalSummary["preparation"]>,
    revisionStatus: ProposalSummary["revisionStatus"] = "draft",
) {
    const counts =
        preparation.captured === undefined
            ? `${preparation.checked} of ${preparation.total} candidates checked.`
            : `${preparation.captured} of ${preparation.total} source contents saved · ${preparation.assessed ?? 0} assessed · ${preparation.remaining ?? 0} not yet processed${preparation.failed ? ` · ${preparation.failed} could not be fully prepared` : ""}.`;
    if (revisionStatus === "approved")
        return {
            status: "default" as const,
            title: "Approved source reading",
            description:
                "Inspect the captured passages and recorded limitations. Changes to the source set need a new revision.",
            counts,
        };
    if (preparation.status === "started")
        return {
            status: "info" as const,
            title: preparation.progress
                ? {
                      reading: "Reading candidate sources",
                      comparison: "Checking source contributions",
                      supplement: "Checking for additional sources",
                      proposal: "Preparing your proposal",
                  }[preparation.progress.phase]
                : "Preparing source selection",
            description:
                preparation.progress?.phase === "comparison"
                    ? "Saved readings are being compared with available primary documents. You can keep inspecting sources below."
                    : preparation.progress?.phase === "proposal"
                      ? "The source selection is being updated from the saved results. It will be ready for your review shortly."
                      : "Completed readings appear below as sources are checked. You can inspect them while preparation continues.",
            counts,
        };
    if (
        preparation.proposalPublished === false &&
        preparation.status !== "blocked"
    )
        return {
            status: "warning" as const,
            title: "Source preparation interrupted",
            description:
                "Preparation stopped before the proposal was updated. Saved readings and your source decisions are preserved.",
            counts,
        };
    if (
        preparation.stopCode === "execution_slot_unavailable" ||
        (preparation.canResume &&
            !preparation.stopCode &&
            preparation.checked === 0)
    )
        return {
            status: "warning" as const,
            title: "Source link saved",
            description:
                "Finish the other dossier, then continue preparation to read the source you added.",
            counts,
        };
    if (preparation.status === "blocked")
        return {
            status: "danger" as const,
            title: "Source preparation interrupted",
            description:
                preparation.stopCode === "missing_configuration" ||
                preparation.stopCode === "paid_work_disabled"
                    ? "Preparation stopped because source assessment was unavailable. Saved contents and your source decisions are preserved. Review the available material and originals."
                    : "Preparation stopped before it could finish. Saved contents and your source decisions are preserved; unprocessed sources have not been ruled irrelevant.",
            counts,
        };
    if (preparation.pendingComparisons)
        return {
            status: "warning" as const,
            title: "Ready for review with limitations",
            description: preparation.canResume
                ? "Some source comparisons remain incomplete. Review the saved readings and limitations before approving. You can resume the remaining checks."
                : "Some source comparisons remain incomplete. Review the saved readings and limitations before approving the source set.",
            counts,
        };
    const hasLimitations =
        preparation.status === "partial" ||
        !!preparation.failed ||
        !!preparation.remaining;
    return {
        status: hasLimitations ? ("warning" as const) : ("success" as const),
        title: hasLimitations
            ? "Ready for review with limitations"
            : "Ready for your review",
        description:
            "Source readings informed this proposal. Review the available passages and remaining limitations, then approve the source set.",
        counts,
    };
}

/** Presents the persisted journey while supplemental work stays inside the source-checking stage. */
export function sourcePreparationStages(
    preparation: NonNullable<ProposalSummary["preparation"]>,
) {
    const active = preparation.status === "started";
    const phase = preparation.progress?.phase;
    const published =
        preparation.proposalPublished ??
        (!active && preparation.status !== "blocked");
    const readingsComplete =
        preparation.initialReadingsCompletedAt !== undefined ||
        (phase !== undefined && phase !== "reading") ||
        (published && preparation.remaining === 0);
    const checksComplete =
        (phase === "proposal" || published) && !preparation.pendingComparisons;
    const step = !readingsComplete ? 1 : phase === "proposal" ? 3 : 2;
    type StageStatus = "complete" | "running" | "pending" | "failed";
    const state = (complete: boolean, current: boolean): StageStatus =>
        complete
            ? "complete"
            : current
              ? active
                  ? "running"
                  : "failed"
              : "pending";
    const comparison =
        phase === "comparison" &&
        preparation.progress?.total !== undefined &&
        preparation.progress.total > 0;
    return {
        step,
        published,
        stages: [
            {
                id: "reading",
                label: "Read candidate sources",
                status: state(readingsComplete, !readingsComplete),
                detail: readingsComplete
                    ? "Initial source checks finished"
                    : `${preparation.checked} of ${preparation.total} sources checked`,
                ...(!readingsComplete && preparation.total > 0
                    ? { current: preparation.checked, total: preparation.total }
                    : {}),
                progressLabel: "Source reading progress",
            },
            {
                id: "checks",
                label: "Check source contributions",
                status: state(
                    checksComplete,
                    readingsComplete && !checksComplete,
                ),
                detail: checksComplete
                    ? "Source checks finished"
                    : !active && preparation.pendingComparisons
                      ? `${preparation.pendingComparisons} ${preparation.pendingComparisons === 1 ? "source comparison remains" : "source comparisons remain"} unfinished`
                      : !active && readingsComplete
                        ? "Source checks did not finish"
                        : phase === "supplement"
                          ? "Checking for additional sources"
                          : readingsComplete && phase === "reading"
                            ? "Reading additional sources using saved results"
                            : comparison
                              ? `${preparation.progress?.current ?? 0} of ${preparation.progress?.total} source comparisons checked`
                              : preparation.pendingComparisons
                                ? `${preparation.pendingComparisons} source comparisons remain unfinished`
                                : readingsComplete
                                  ? "Source checks have not finished"
                                  : "Starts after the initial readings finish",
                ...(comparison
                    ? {
                          current: preparation.progress?.current ?? 0,
                          total: preparation.progress?.total,
                      }
                    : {}),
                progressLabel: "Source comparison progress",
            },
            {
                id: "proposal",
                label: "Prepare your proposal",
                status: state(published, active && phase === "proposal"),
                detail: published
                    ? "Proposal saved for your review"
                    : phase === "proposal"
                      ? "Organizing the saved results for your review"
                      : "Starts after source checks finish",
                progressLabel: "Proposal preparation progress",
            },
        ],
    };
}

/** Explains the server-owned availability of preparation without exposing operational details. */
export function sourcePreparationActionCopy(
    action: ProposalSummary["preparationAction"],
) {
    switch (action?.reason) {
        case "disabled":
            return "Source reading is currently unavailable.";
        case "configuration_unavailable":
            return "Preparation is currently unavailable. You can still review the available sources and your source decisions.";
        case "busy":
            return "Wait for the running preparation to finish before continuing.";
        case "read_only":
            return "This source set is approved and read-only.";
        case "cooldown":
            return "Preparation can be tried again shortly. Saved material and your source decisions are preserved.";
        case "work_budget_exhausted":
            return "The source reading allowance has been used. Review the saved readings and original sources before approving this source set with its limitations.";
        case "incident_budget_exhausted":
            return "Preparation stopped after repeated service failures. Review the saved readings and original sources before approving this source set with its limitations.";
        case "attempts_exhausted":
            return "The available attempts for the remaining work have been used. Review the saved readings and originals, or add a public source.";
        case "outcome_unknown":
            return "Some earlier work could not be confirmed and cannot safely be repeated. Review the saved readings and originals, or add another public source.";
        case "no_eligible_work":
            return "The remaining source checks cannot be resumed. Review their limitations and saved readings, or add a public source.";
        default:
            return null;
    }
}

/** Compact processing labels remain distinct from source inclusion and factual verification. */
export function sourceReadingStatusLabel(
    status: NonNullable<ReviewSource["readingStatus"]>,
) {
    return {
        not_started: "Not yet read",
        preparing: "In preparation",
        assessment_unavailable: "Assessment unavailable",
        reading_failed: "Reading unavailable",
        complete: "Assessed",
        partial: "Assessed · partial reading",
    }[status];
}

/** Describes the stored reading outcome without certifying the source's assertions. */
export function sourceReadingCopy(
    source: Pick<
        ReviewSource,
        | "inspectionStatus"
        | "qualificationStatus"
        | "qualification"
        | "roleAvailability"
        | "readingStatus"
    >,
) {
    if (source.readingStatus === "not_started")
        return {
            status: "default" as const,
            title: "Source not yet processed",
            description:
                "Preparation has not reached this source. You can review the original; its usefulness has not been assessed.",
        };
    if (source.readingStatus === "preparing")
        return {
            status: "info" as const,
            title: "Source preparation in progress",
            description:
                "This source is being prepared or waiting its turn. Completed results will appear here.",
        };
    if (
        source.readingStatus === "assessment_unavailable" ||
        (!source.readingStatus && source.qualificationStatus === "unavailable")
    )
        return {
            status: "warning" as const,
            title: "Content saved; assessment unavailable",
            description:
                "The source content was saved, but its contribution could not be assessed. Review the original before relying on it. This does not make the source irrelevant.",
        };
    if (
        source.readingStatus === "reading_failed" ||
        (!source.readingStatus && source.inspectionStatus === "unavailable")
    )
        return {
            status: "danger" as const,
            title: "Source could not be read",
            description:
                "Inspect the original before approving the selection. An unreadable source has not been ruled irrelevant.",
        };
    if (!source.qualification) return null;
    if (
        source.qualification.findings.some((finding) =>
            finding.reasonCodes?.some((code) =>
                [
                    "qualification_conflict",
                    "qualification_scope_unknown",
                ].includes(code),
            ),
        )
    )
        return {
            status: "warning" as const,
            title: "Source reading needs review",
            description:
                "Some contributions are on hold. Inspect their passages and restrictions before relying on them. Other contributions retain their stated uses.",
        };
    const contributions =
        source.roleAvailability?.filter(
            (role) => role.state !== "not_established",
        ) ?? [];
    if (contributions.length === 0)
        return {
            status: "warning" as const,
            title: "Need not established",
            description:
                "The inspected passages do not establish a suitable contribution. Inspect the source or add a stronger reference.",
        };
    const limited =
        source.inspectionStatus === "partial" ||
        source.qualification.limitations.length > 0 ||
        source.qualification.findings.some(
            (finding) => finding.usage !== "documentary",
        ) ||
        contributions.some((role) => role.state === "limited");
    return {
        status: limited ? ("warning" as const) : ("success" as const),
        title: limited
            ? "Useful with limitations"
            : "Useful material identified",
        description:
            "This assessment prepares source selection. It does not verify the source's assertions.",
    };
}

export function sourceFindingKindLabel(
    kind: SourceQualification["findings"][number]["kind"],
) {
    return {
        asserted_fact: "Source assertion",
        attributed_argument: "Attributed argument",
        forecast: "Forecast",
        reported_outcome: "Reported outcome",
        mixed_or_uncertain: "Mixed or unclear",
    }[kind];
}

export function sourceUsageCopy(
    usage: NonNullable<ReviewSource["roleAvailability"]>[number]["usage"],
    comparisonOutcome?: SourceQualification["findings"][number]["comparisonOutcome"],
    kind?: SourceQualification["findings"][number]["kind"],
    reasonCodes: readonly string[] = [],
) {
    if (reasonCodes.includes("qualification_conflict"))
        return "The reading gives conflicting assessments of this material. This contribution does not count toward coverage.";
    if (reasonCodes.includes("qualification_scope_unknown"))
        return "The scope of an earlier reading restriction is unclear. This contribution does not count toward coverage.";

    if (comparisonOutcome === "possible_conflict") {
        return "A cited primary passage raises a possible conflict. Review the evidence before relying on this contribution. This concern is not a verified error.";
    }
    if (comparisonOutcome === "inconclusive") {
        return "The available captured primary passages did not resolve this contribution. Verify its key premise before relying on it.";
    }
    if (comparisonOutcome === "no_conflict_observed") {
        return usage === "attributed_argument_only" ||
            ["attributed_argument", "forecast"].includes(kind ?? "")
            ? "Use only as an attributed hypothesis. No conflict was observed within the cited captured primary passages, but that does not verify the argument as fact."
            : "No conflict was observed within the cited captured primary passages. This comparison is limited to those passages and does not verify the assertion.";
    }
    if (
        usage === "verification_required" &&
        ["attributed_argument", "forecast"].includes(kind ?? "")
    ) {
        return "No completed comparison with applicable captured primary passages is available. Verify this contribution before using it even as an attributed hypothesis.";
    }
    return {
        documentary:
            "May contribute documentary material. Individual assertions still require evidence review.",
        historical_only:
            "Use as historical context only. This passage does not establish current conditions.",
        attributed_argument_only:
            "Use only as an attributed hypothesis. This passage does not establish a verified fact.",
        verification_required:
            "Verify the relevant assertions before factual use.",
        blocked:
            "This material has not established a suitable contribution to this need.",
    }[usage];
}

const unavailableAssessmentCopy =
    "The assessment refers to the cited passages and is limited to the available context.";

/** Keeps model-authored reading and comparison notes away from internal pins and workflow details. */
export function sourceAssessmentExplanationCopy(explanation: string): string {
    const normalized = explanation.replace(/\s+/g, " ").trim();
    const exposesInternalDetails =
        /\b(?:possible_conflict|no_conflict_observed|inconclusive|source_comparison|source_qualification|provider_unavailable|invalid_output|not_run|aiTaskResults|sourceCaptures|api[_ -]?key|request[_ -]?id|http\s+\d{3}|ETIMEDOUT|ECONNRESET|ECONNREFUSED|AbortError|TimeoutError)\b/i.test(
            normalized,
        ) ||
        /\b(?:target|primary|passage|finding)[-_]?\d+\b/i.test(normalized) ||
        /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(normalized) ||
        /\b[a-z0-9]{24,}\b/i.test(normalized);
    if (!normalized || normalized.length > 600 || exposesInternalDetails) {
        return unavailableAssessmentCopy;
    }
    return normalized;
}

/** Omits unusable contribution prose while keeping its quotation and usage restrictions visible. */
export function sourceFindingContributionCopy(summary: string): string | null {
    const contribution = sourceAssessmentExplanationCopy(summary);
    return contribution === unavailableAssessmentCopy ? null : contribution;
}

/** Model concerns remain points to inspect, never verified source errors. */
export function sourceReadingConcernCopy(
    code: SourceQualification["limitations"][number]["code"],
) {
    return readingConcernLabels[code];
}

/** Describes where a recorded restriction applies without interpreting its prose. */
export function sourceRestrictionScopeCopy(
    limitation: SourceQualification["limitations"][number],
): string {
    const scope = limitation.scope;
    if (!scope)
        return "The scope of this earlier restriction was not recorded.";
    if (scope.kind === "document") return "Applies to the whole document.";
    const roles = scope.roles?.map(sourceCoverageRoleLabel).join(", ");
    if (scope.kind === "roles") return `Applies to: ${roles}.`;
    return roles
        ? `Applies to the specified passages for: ${roles}.`
        : "Applies to the specified passages across all needs.";
}

const readingConcernLabels = {
    unverified_assertion: "Some assertions still need verification.",
    factual_conflict:
        "Some statements may need comparison. A contradiction has not been established.",
    historical: "Historical material may not describe current conditions.",
    period_unestablished:
        "The relevant reporting period has not been established.",
    partial_reading: "Only part of the document was reviewed.",
    publisher_unverified: "The publisher's authority has not been established.",
    dependency_unclear:
        "It is unclear whether the useful passage depends on an unverified assertion.",
    no_substantive_content:
        "The reading did not establish enough substantive material for the intended need.",
} satisfies Record<SourceQualification["limitations"][number]["code"], string>;

/** Returns the analyst-readable label for an assessment dimension key. */
export function dimensionLabel(key: string): string {
    return domainDimensionLabel(
        key as Parameters<typeof domainDimensionLabel>[0],
    );
}

/** Translates persisted source decisions for display. */
export function sourceDecisionLabel(decision: Source["decision"]): string {
    return sourceDecisionLabels[decision];
}

type EvidenceClaimListItem = FunctionReturnType<
    typeof api.evidenceMatrix.listClaims
>["page"][number];
type EvidenceClaimDetail = FunctionReturnType<
    typeof api.evidenceMatrix.getClaimDetail
>;
type ClaimClassification = EvidenceClaimListItem["classification"];
type ClaimPolicy = NonNullable<EvidenceClaimListItem["policy"]>;
type ClaimProcessing = EvidenceClaimListItem["processing"];
type EvidenceRelation = EvidenceClaimDetail["evidence"][number]["relation"];
type SourceOrigin = EvidenceClaimDetail["evidence"][number]["source"]["origin"];

const claimClassificationLabels = {
    Fact: "Fact",
    Inference: "Inference",
    Hypothesis: "Hypothesis",
    Unknown: "Unknown",
} satisfies Record<ClaimClassification, string>;

const claimPolicyLabels = {
    pass: "Passed evidence review",
    needs_review: "Needs additional evidence review",
    blocked: "Blocked by evidence rules",
} satisfies Record<ClaimPolicy, string>;

const claimProcessingLabels = {
    complete: "Evidence ready",
    partial: "Partial evidence",
    failed: "Evidence retrieval failed",
    in_progress: "Evidence retrieval in progress",
} satisfies Record<ClaimProcessing, string>;

const evidenceRelationLabels = {
    supporting: "Supports this claim",
    counter: "Counters this claim",
    context: "Context for this claim",
} satisfies Record<EvidenceRelation, string>;

const evidenceSourceOriginLabels = {
    sec: "SEC filing",
    exa: "Public web source",
    analyst_url: "Added by analyst",
} satisfies Record<SourceOrigin, string>;

/** Returns the analyst-facing classification label for a persisted claim value. */
export function claimClassificationLabel(
    classification: ClaimClassification,
): string {
    return claimClassificationLabels[classification];
}

/** Translates a persisted claim evidence-policy result for review display. */
export function claimPolicyLabel(
    policy: ClaimPolicy | undefined,
): string | null {
    return policy ? claimPolicyLabels[policy] : null;
}

/** Translates the persisted evidence-retrieval state of a claim. */
export function claimProcessingLabel(processing: ClaimProcessing): string {
    return claimProcessingLabels[processing];
}

/** Explains how a cited passage relates to its claim. */
export function evidenceRelationLabel(relation: EvidenceRelation): string {
    return evidenceRelationLabels[relation];
}

/** Explains the cited source origin at the analyst presentation boundary. */
export function evidenceSourceOriginLabel(origin: SourceOrigin): string {
    return evidenceSourceOriginLabels[origin];
}

/** Renders a reproducible locator summary without exposing storage internals. */
export function locatorLabel(
    locator: EvidenceClaimDetail["evidence"][number]["locator"],
): string {
    if (locator.kind === "pdf") {
        return locator.pageNumber
            ? `PDF page ${locator.pageNumber}`
            : "PDF document";
    }
    return "Web page";
}

interface EvidenceStatusCopy {
    eyebrow: string;
    title: string;
    description: string;
}

/** Analyst-safe state copy for the read-only evidence matrix. */
export const evidenceStatusCopy = {
    ready: {
        eyebrow: "Evidence review",
        title: "Evidence is ready for review",
        description:
            "Claims below cite exact public passages from the approved source set.",
    },
    preparing: {
        eyebrow: "Evidence review",
        title: "Evidence is being prepared",
        description:
            "Claims will appear here once extraction and evidence review finish.",
    },
    unavailable: {
        eyebrow: "Evidence review",
        title: "Evidence is temporarily unavailable",
        description:
            "Claim generation is not available for this dossier right now. Your approved sources are preserved for when preparation can continue.",
    },
    failed: {
        eyebrow: "Evidence review",
        title: "Evidence could not be prepared",
        description:
            "Your approved source set is preserved. Review Sources to inspect the collection before trying again.",
    },
} satisfies Record<
    "ready" | "preparing" | "unavailable" | "failed",
    EvidenceStatusCopy
>;

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

/** Distinguishes an observed response from an unconfirmed dispatch in protected operations. */
export function providerDispatchLabel(
    outcome?: "not_dispatched" | "response_received" | "unknown",
): string {
    if (outcome === "not_dispatched") return "Not dispatched";
    if (outcome === "response_received") return "Response received";
    return "Dispatch outcome unconfirmed";
}

export function providerOperationLabel(operation: string): string {
    return providerOperationLabels[operation] ?? "Provider operation";
}

export function providerErrorLabel(errorCode: string): string {
    return providerErrorLabels[errorCode] ?? "Provider attempt needs review";
}

/** Describes recovery consequences without exposing transport or workflow diagnostics. */
export function sourceRecoveryFeedback(
    result: Pick<
        FunctionReturnType<
            typeof api.sourceSelectionProposalActions.recoverDiscovery
        >,
        "reason" | "outcome"
    > & { insertedCount?: number },
): {
    status: "default" | "success" | "warning" | "danger";
    title: string;
    description: string;
} {
    if ((result.insertedCount ?? 0) > 0)
        return {
            status: "success",
            title: `${result.insertedCount} candidate${result.insertedCount === 1 ? "" : "s"} to review`,
            description:
                "Review the new candidates before including them. Finding sources does not establish documentary coverage.",
        };
    switch (result.reason) {
        case "capacity_reached":
            return {
                status: "warning",
                title: "Source limit reached",
                description:
                    "Review existing candidates or approve with the remaining coverage limitations.",
            };
        case "cooldown":
            return {
                status: "default",
                title: "Search will be available shortly",
                description:
                    "Your sources and decisions are unchanged. You can retry when the countdown ends.",
            };
        case "in_progress":
            return {
                status: "default",
                title: "Searching sources…",
                description:
                    "Your existing sources remain available while this search finishes.",
            };
        case "no_new_candidates":
            return {
                status: "default",
                title: "No new sources found",
                description:
                    "Review existing candidates or add a source link. Coverage needs may remain.",
            };
        case "request_rejected":
            return {
                status: "danger",
                title: "Search could not be completed",
                description:
                    "The search request was rejected. Add a source link or review existing candidates. Your source decisions are unchanged.",
            };
        case "unavailable":
            return {
                status: "danger",
                title: "Search unavailable",
                description:
                    "Your sources and decisions are unchanged. Retry when available, review existing candidates, or add a source link.",
            };
        default:
            return result.outcome === "partial"
                ? {
                      status: "warning",
                      title: "Some searches still need attention",
                      description:
                          "Review the updated proposal and remaining coverage needs, or add a source link.",
                  }
                : {
                      status: "success",
                      title: "Search completed",
                      description:
                          "Review the updated proposal and any remaining coverage needs before approval.",
                  };
    }
}
