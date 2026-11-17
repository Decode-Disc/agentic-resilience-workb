import type { CoveragePreset } from "@convex/domain/researchPlan";
import { type Infer, v } from "convex/values";
import type { SourceComparisonDisposition } from "./sourceComparison";
import type { SourceQualification } from "./sourceQualification";
import type { sourceDecisionValidator } from "./validators";

export const SOURCE_SELECTION_POLICY_VERSION = "source-selection-v14";
export const SOURCE_PUBLISHER_REGISTRY_VERSION = "source-publishers-v4";

/** These policy updates reuse saved qualification and analyst decisions without provider I/O. */
export function canRefreshSourceSelectionPolicy(
    policyVersion: string,
): boolean {
    return (
        policyVersion === "source-selection-v10" ||
        policyVersion === "source-selection-v11" ||
        policyVersion === "source-selection-v12" ||
        policyVersion === "source-selection-v13" ||
        policyVersion === SOURCE_SELECTION_POLICY_VERSION
    );
}

export const SOURCE_FAMILIES = [
    "regulatory",
    "investor_relations",
    "official_product",
    "official_commercial",
    "counter_evidence",
    "official_security",
    "independent_analysis",
] as const;

export const SOURCE_COVERAGE_ROLES = [
    "regulatory_annual",
    "regulatory_interim",
    "regulatory_material_event",
    "investor_results",
    "investor_presentation",
    "official_product_platform",
    "official_product_integration",
    "official_commercial_pricing",
    "official_commercial_terms",
    "counter_evidence_primary",
    "counter_evidence_secondary",
    "official_security_architecture",
    "official_security_trust",
    "independent_analysis_primary",
    "independent_analysis_secondary",
] as const;

export const SOURCE_DOCUMENT_KINDS = [
    "regulatory_annual",
    "regulatory_interim",
    "regulatory_material",
    "regulatory_proxy",
    "regulatory_ownership",
    "regulatory_registration",
    "regulatory_other",
    "earnings_release",
    "investor_presentation",
    "earnings_transcript",
    "official_product_documentation",
    "official_integration_documentation",
    "official_pricing",
    "official_commercial_terms",
    "official_security_documentation",
    "independent_analysis",
    "news_reporting",
    "partner_evidence",
    "community_content",
    "search_or_index",
    "unverified_counter_evidence",
    "unknown",
] as const;

export const SOURCE_AUTHORITY_TIERS = [
    "regulator_primary",
    "company_primary",
    "company_hosted_ir",
    "institutional_independent",
    "qualified_partner",
    "unverified",
    "analyst_supplied",
] as const;

export const SOURCE_COMPANY_LINKAGE_BASES = [
    "structural",
    "discovery_metadata",
    "unverified",
    "not_evaluated",
    "inspected_content",
] as const;

export const sourceFamilyValidator = v.union(
    ...SOURCE_FAMILIES.map((value) => v.literal(value)),
);
export const sourceCoverageRoleValidator = v.union(
    ...SOURCE_COVERAGE_ROLES.map((value) => v.literal(value)),
);
export const sourceDocumentKindValidator = v.union(
    ...SOURCE_DOCUMENT_KINDS.map((value) => v.literal(value)),
);
export const sourceAuthorityTierValidator = v.union(
    ...SOURCE_AUTHORITY_TIERS.map((value) => v.literal(value)),
);

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];
export type SourceCoverageRole = (typeof SOURCE_COVERAGE_ROLES)[number];

const selectionContributionsValidator = v.array(
    v.object({
        key: v.string(),
        basis: v.union(
            v.literal("inspected_content"),
            v.literal("discovery_metadata"),
        ),
        kind: v.union(
            v.literal("documentary_role"),
            v.literal("report_candidate"),
            v.literal("filing_candidate"),
            v.literal("publisher"),
            v.literal("document_candidate"),
        ),
        role: v.optional(sourceCoverageRoleValidator),
        reportingPeriodEnd: v.optional(v.string()),
    }),
);
export const sourceSelectionRationaleValidator = v.union(
    v.object({
        version: v.literal(1),
        trigger: v.literal("analyst_reference"),
        contributions: selectionContributionsValidator,
    }),
    v.object({
        version: v.literal(1),
        trigger: v.literal("required_role"),
        role: sourceCoverageRoleValidator,
        contributions: selectionContributionsValidator,
    }),
    v.object({
        version: v.literal(1),
        trigger: v.literal("distinct_contribution"),
        contributions: selectionContributionsValidator,
    }),
);
export type SourceSelectionRationale = Infer<
    typeof sourceSelectionRationaleValidator
>;
export type SourceDocumentKind = (typeof SOURCE_DOCUMENT_KINDS)[number];
export type SourceAuthorityTier = (typeof SOURCE_AUTHORITY_TIERS)[number];
export type SourceCompanyLinkageBasis =
    (typeof SOURCE_COMPANY_LINKAGE_BASES)[number];
export type SourceSelectionDisposition =
    | "recommended"
    | "needs_attention"
    | "alternative";
export const SOURCE_SELECTION_REASON_CODES = [
    "added_by_analyst",
    "required_family_coverage",
    "ranked_fill",
    "unrecognized_source_family",
    "not_selected",
    "required_coverage_role",
    "additional_coverage",
    "canonical_duplicate",
    "metadata_duplicate",
    "search_or_index",
    "low_information_document",
    "company_identity_unverified",
    "unverified_publisher",
    "unverified_counter_evidence",
    "qualified_partner_manual_review",
    "no_new_coverage",
    "recommendation_ceiling_reached",
    "integrity_conflict",
    "targeted_search_review",
] as const;
export const sourceSelectionReasonCodeValidator = v.union(
    ...SOURCE_SELECTION_REASON_CODES.map((code) => v.literal(code)),
);
export type SourceSelectionReasonCode =
    (typeof SOURCE_SELECTION_REASON_CODES)[number];

export type SourceSelectionCandidate = {
    sourceId: string;
    canonicalUrl: string;
    title: string;
    origin: "sec" | "exa" | "analyst_url";
    category: string;
    publishedAt?: number;
    providerReference?: string;
    secForm?: string;
    secAccessionNumber?: string;
    providerResultPosition?: number;
    discoveryQueryIndex?: number;
    requiresAnalystReview?: boolean;
    createdAt: number;
    inspection?:
        | {
              status: "qualified";
              qualification: SourceQualification;
              readingCompleteness: "complete" | "partial";
              comparisonOutcomes?: Record<number, SourceComparisonDisposition>;
          }
        | { status: "unavailable"; reasonCode: string };
};

export const SOURCE_EVIDENCE_USAGES = [
    "documentary",
    "historical_only",
    "attributed_argument_only",
    "verification_required",
    "blocked",
] as const;

export const sourceRoleAvailabilityValidator = v.array(
    v.object({
        role: sourceCoverageRoleValidator,
        state: v.union(
            v.literal("available"),
            v.literal("limited"),
            v.literal("not_established"),
        ),
        reasonCodes: v.array(v.string()),
        usage: v.union(
            ...SOURCE_EVIDENCE_USAGES.map((usage) => v.literal(usage)),
        ),
    }),
);
export type SourceRoleAvailability = Infer<
    typeof sourceRoleAvailabilityValidator
>[number];

/** Explicit secondary-source assertions need the same premise check as arguments. */
export function sourceFindingRequiresComparison(
    finding: SourceQualification["findings"][number],
): boolean {
    return (
        ["attributed_argument", "forecast"].includes(finding.kind) ||
        (Boolean(finding.relevance && finding.scope) &&
            finding.role.startsWith("independent_analysis_") &&
            ["asserted_fact", "reported_outcome"].includes(finding.kind))
    );
}

/** Evaluates a finding once so selection, review and evidence use share its restrictions. */
export function sourceFindingUsage(
    finding: SourceQualification["findings"][number],
    roleUsage: SourceRoleAvailability["usage"],
    comparisonOutcome?: SourceComparisonDisposition,
    limitations: SourceQualification["limitations"] = [],
    policyVersion = SOURCE_SELECTION_POLICY_VERSION,
): { usage: SourceRoleAvailability["usage"]; reasonCodes: string[] } {
    const applicable = limitations.filter((limitation) => {
        const scope = limitation.scope;
        if (scope?.kind === "document") return true;
        if (scope?.kind === "roles") return scope.roles.includes(finding.role);
        const keys =
            scope?.kind === "passages"
                ? scope.passageKeys
                : limitation.passages.map((p) => p.passageKey);
        return (
            (scope?.kind !== "passages" ||
                scope.roles === null ||
                scope.roles.includes(finding.role)) &&
            (keys.length === 0 ||
                finding.passages.some((p) => keys.includes(p.passageKey)))
        );
    });
    if (policyVersion === SOURCE_SELECTION_POLICY_VERSION) {
        const conflict = applicable.find(
            (item) => item.code === "no_substantive_content",
        );
        if (conflict)
            return {
                usage: "blocked",
                reasonCodes: [
                    conflict.scope
                        ? "qualification_conflict"
                        : "qualification_scope_unknown",
                ],
            };
    }
    if (finding.dependsOnFlaggedAssertion || roleUsage === "blocked")
        return { usage: "blocked", reasonCodes: [] };
    if (comparisonOutcome === "possible_conflict")
        return {
            usage: "verification_required",
            reasonCodes: ["possible_conflict"],
        };
    if (
        sourceFindingRequiresComparison(finding) &&
        comparisonOutcome !== "no_conflict_observed"
    )
        return {
            usage: "verification_required",
            reasonCodes: ["comparison_required"],
        };
    if (finding.period === "historical" || roleUsage === "historical_only")
        return { usage: "historical_only", reasonCodes: ["historical"] };
    if (finding.kind === "mixed_or_uncertain")
        return {
            usage: "verification_required",
            reasonCodes: ["content_nature_uncertain"],
        };
    if (
        ["asserted_fact", "reported_outcome"].includes(finding.kind) &&
        applicable.some((item) =>
            [
                "factual_conflict",
                "unverified_assertion",
                "dependency_unclear",
            ].includes(item.code),
        )
    )
        return {
            usage: "verification_required",
            reasonCodes: ["unverified_assertion"],
        };
    if (
        ["attributed_argument", "forecast"].includes(finding.kind) &&
        ["documentary", "attributed_argument_only"].includes(roleUsage)
    )
        return { usage: "attributed_argument_only", reasonCodes: [] };
    return { usage: roleUsage, reasonCodes: [] };
}

export type SourceSelectionCompany = {
    cik: string;
    legalName: string;
    ticker: string;
    websiteUrl?: string;
    investorRelationsUrl?: string;
};

export type SourceSelectionProposalResult = {
    items: Array<{
        sourceId: string;
        disposition: SourceSelectionDisposition;
        sourceFamily: SourceFamily | "unrecognized" | "analyst_supplied";
        documentKind: SourceDocumentKind;
        authorityTier: SourceAuthorityTier;
        companyLinkageBasis: SourceCompanyLinkageBasis;
        coverageContributions: Array<string>;
        recommendationContributions: Array<string>;
        declaredCoverageRoles: Array<SourceCoverageRole>;
        eligibleCoverageRoles: Array<SourceCoverageRole>;
        roleAvailability?: SourceRoleAvailability[];
        inspectionStatus?: "complete" | "partial" | "unavailable";
        duplicateOfSourceId?: string;
        rank: number;
        reasonCodes: Array<SourceSelectionReasonCode>;
        selectionRationale?: SourceSelectionRationale;
    }>;
    gaps: Array<SourceFamily>;
    coverageGaps: Array<SourceCoverageRole>;
    documentaryCoverageGaps: Array<SourceCoverageRole>;
    counts: {
        recommended: number;
        needsAttention: number;
        alternative: number;
    };
};

type ClassifiedCandidate = SourceSelectionCandidate & {
    sourceFamily: SourceFamily | "unrecognized" | "analyst_supplied";
    documentKind: SourceDocumentKind;
    authorityTier: SourceAuthorityTier;
    companyLinkageBasis: SourceCompanyLinkageBasis;
    coverageContributions: Array<string>;
    recommendationContributions: Array<string>;
    declaredCoverageRoles: Array<SourceCoverageRole>;
    eligibleCoverageRoles: Array<SourceCoverageRole>;
    host: string;
    companyIdentityConfirmed: boolean;
    eligible: boolean;
    alternativeReason?: SourceSelectionReasonCode;
    needsAttentionReason?: SourceSelectionReasonCode;
    duplicateOfSourceId?: string;
    roleAvailability?: SourceRoleAvailability[];
    documentaryCoverageRoles?: SourceCoverageRole[];
    inspectionStatus?: "complete" | "partial" | "unavailable";
};

const IR_HOSTS = new Set([
    "q4cdn.com",
    "q4inc.com",
    "q4ir.com",
    "nasdaqomx.com",
]);
type PublisherCapability = {
    host: string;
    authorityTier: "institutional_independent" | "qualified_partner";
    documentKind: SourceDocumentKind;
    eligibleCoverageRoles: ReadonlyArray<SourceCoverageRole>;
};

const PUBLISHER_CAPABILITY_REGISTRY: ReadonlyArray<PublisherCapability> = [
    {
        host: "reuters.com",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "bloomberg.com",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "ft.com",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "wsj.com",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "morningstar.com",
        authorityTier: "institutional_independent",
        documentKind: "independent_analysis",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
            "independent_analysis_primary",
            "independent_analysis_secondary",
        ],
    },
    {
        host: "gartner.com",
        authorityTier: "institutional_independent",
        documentKind: "independent_analysis",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
            "independent_analysis_primary",
            "independent_analysis_secondary",
        ],
    },
    {
        host: "forrester.com",
        authorityTier: "institutional_independent",
        documentKind: "independent_analysis",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
            "independent_analysis_primary",
            "independent_analysis_secondary",
        ],
    },
    {
        host: "idc.com",
        authorityTier: "institutional_independent",
        documentKind: "independent_analysis",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
            "independent_analysis_primary",
            "independent_analysis_secondary",
        ],
    },
    {
        host: "ftc.gov",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "justice.gov",
        authorityTier: "institutional_independent",
        documentKind: "news_reporting",
        eligibleCoverageRoles: [
            "counter_evidence_primary",
            "counter_evidence_secondary",
        ],
    },
    {
        host: "aws.amazon.com",
        authorityTier: "qualified_partner",
        documentKind: "partner_evidence",
        eligibleCoverageRoles: [],
    },
    {
        host: "azuremarketplace.microsoft.com",
        authorityTier: "qualified_partner",
        documentKind: "partner_evidence",
        eligibleCoverageRoles: [],
    },
    {
        host: "appsource.microsoft.com",
        authorityTier: "qualified_partner",
        documentKind: "partner_evidence",
        eligibleCoverageRoles: [],
    },
    {
        host: "gsa.gov",
        authorityTier: "qualified_partner",
        documentKind: "partner_evidence",
        eligibleCoverageRoles: [],
    },
    {
        host: "carahsoft.com",
        authorityTier: "qualified_partner",
        documentKind: "partner_evidence",
        eligibleCoverageRoles: [],
    },
];
const EXCLUDED_PUBLISHER_HOSTS = new Set([
    "askcyborg.com",
    "koalagains.com",
    "orbyd.app",
]);
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);
const INTERIM_FORMS = new Set(["10-Q"]);
const MATERIAL_FORMS = new Set(["8-K", "6-K"]);
const OWNERSHIP_FORMS = new Set(["3", "4", "5", "144"]);
const REGISTRATION_FORMS = new Set([
    "S-1",
    "S-3",
    "S-4",
    "S-8",
    "F-1",
    "F-3",
    "F-4",
    "424B",
]);

const AUTHORITY_PRIORITY: Record<SourceAuthorityTier, number> = {
    analyst_supplied: 0,
    regulator_primary: 1,
    company_primary: 2,
    company_hosted_ir: 3,
    institutional_independent: 4,
    qualified_partner: 5,
    unverified: 6,
};

export const FAMILY_BY_ROLE: Readonly<
    Record<SourceCoverageRole, SourceFamily>
> = {
    regulatory_annual: "regulatory",
    regulatory_interim: "regulatory",
    regulatory_material_event: "regulatory",
    investor_results: "investor_relations",
    investor_presentation: "investor_relations",
    official_product_platform: "official_product",
    official_product_integration: "official_product",
    official_commercial_pricing: "official_commercial",
    official_commercial_terms: "official_commercial",
    counter_evidence_primary: "counter_evidence",
    counter_evidence_secondary: "counter_evidence",
    official_security_architecture: "official_security",
    official_security_trust: "official_security",
    independent_analysis_primary: "independent_analysis",
    independent_analysis_secondary: "independent_analysis",
};

const REQUIRED_BALANCED_ROLES: ReadonlyArray<SourceCoverageRole> = [
    "regulatory_annual",
    "regulatory_interim",
    "regulatory_material_event",
    "investor_results",
    "investor_presentation",
    "official_product_platform",
    "official_product_integration",
    "official_commercial_pricing",
    "official_commercial_terms",
    "counter_evidence_primary",
    "counter_evidence_secondary",
];

function requiredRoles(preset: CoveragePreset): Array<SourceCoverageRole> {
    const roles = [...REQUIRED_BALANCED_ROLES];
    if (preset === "first_party_depth") {
        roles.push("official_security_architecture", "official_security_trust");
    }
    if (preset === "independent_scrutiny") {
        roles.push(
            "independent_analysis_primary",
            "independent_analysis_secondary",
        );
    }
    return roles;
}

function normalizedHost(value: string): string {
    try {
        return new URL(value).hostname
            .toLocaleLowerCase("en")
            .replace(/^www\./, "");
    } catch {
        return "";
    }
}

function matchesHost(host: string, registeredHost: string): boolean {
    return host === registeredHost || host.endsWith(`.${registeredHost}`);
}

function registeredHost(
    host: string,
    registry: ReadonlySet<string>,
): string | undefined {
    return [...registry].find((entry) => matchesHost(host, entry));
}

function publisherCapability(host: string): PublisherCapability | undefined {
    return PUBLISHER_CAPABILITY_REGISTRY.find((entry) =>
        matchesHost(host, entry.host),
    );
}

function normalizedForm(value: string | undefined): string {
    return (value ?? "").trim().toUpperCase().replace(/\/A$/, "");
}

function inferredSecForm(candidate: SourceSelectionCandidate): string {
    return normalizedForm(candidate.secForm);
}

function normalizedTokens(value: string | undefined): Array<string> {
    return (value ?? "")
        .toLocaleLowerCase("en")
        .replace(
            /\b(inc|corp|corporation|holdings|limited|ltd|company)\b/g,
            " ",
        )
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2);
}

function normalizedCik(value: string | undefined): string {
    return (value ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
}

function secIssuerCik(candidate: SourceSelectionCandidate): string | undefined {
    try {
        const match = new URL(candidate.canonicalUrl).pathname.match(
            /\/Archives\/edgar\/data\/(\d+)(?:\/|$)/i,
        );
        return match?.[1];
    } catch {
        return undefined;
    }
}

function candidateMatchesCompany(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany,
): boolean {
    const pathTokens = decodedPathTokens(candidate.canonicalUrl);
    const domainAlias = normalizedHost(company.websiteUrl ?? "")
        .split(".")[0]
        ?.toLocaleLowerCase("en");
    const legalNameTokens = company.legalName
        .toLocaleLowerCase("en")
        .replace(
            /\b(incorporated|inc|corp|corporation|holdings|limited|ltd|company)\b/g,
            " ",
        )
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
    return (
        Boolean(domainAlias && hasPathToken(pathTokens, domainAlias)) ||
        (legalNameTokens.length >= 2 &&
            hasPathTokenSequence(pathTokens, legalNameTokens))
    );
}

function titleMatchesCompanyDiscoveryMetadata(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany,
): boolean {
    const titleTokens = candidate.title
        .toLocaleLowerCase("en")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const legalNameTokens = company.legalName
        .toLocaleLowerCase("en")
        .replace(
            /\b(incorporated|inc|corp|corporation|holdings|limited|ltd|company)\b/g,
            " ",
        )
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
    const domainAlias = normalizedHost(company.websiteUrl ?? "")
        .split(".")[0]
        ?.toLocaleLowerCase("en");
    return (
        (legalNameTokens.length >= 2 &&
            hasPathTokenSequence(titleTokens, legalNameTokens)) ||
        Boolean(
            domainAlias &&
                domainAlias.length >= 5 &&
                titleTokens.includes(domainAlias),
        )
    );
}

function decodedPathTokens(canonicalUrl: string): Array<string> {
    try {
        return decodeURIComponent(new URL(canonicalUrl).pathname)
            .toLocaleLowerCase("en")
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
    } catch {
        return [];
    }
}

function decodedPathSegments(canonicalUrl: string): Array<string> {
    try {
        return decodeURIComponent(new URL(canonicalUrl).pathname)
            .toLocaleLowerCase("en")
            .split("/")
            .filter(Boolean);
    } catch {
        return [];
    }
}

function hasPathToken(tokens: ReadonlyArray<string>, token: string): boolean {
    return tokens.includes(token);
}

function hasAnyPathToken(
    tokens: ReadonlyArray<string>,
    expected: ReadonlyArray<string>,
): boolean {
    return expected.some((token) => hasPathToken(tokens, token));
}

function hasPathTokenSequence(
    tokens: ReadonlyArray<string>,
    sequence: ReadonlyArray<string>,
): boolean {
    return tokens.some((_, index) =>
        sequence.every((token, offset) => tokens[index + offset] === token),
    );
}

function hasPathSegment(
    segments: ReadonlyArray<string>,
    expected: string,
): boolean {
    return segments.includes(expected);
}

function hasPathSegmentSequence(
    segments: ReadonlyArray<string>,
    sequence: ReadonlyArray<string>,
): boolean {
    return segments.some((_, index) =>
        sequence.every(
            (segment, offset) => segments[index + offset] === segment,
        ),
    );
}

function hasSegmentTokenSequence(
    segments: ReadonlyArray<string>,
    sequence: ReadonlyArray<string>,
): boolean {
    return segments.some((segment) =>
        hasPathTokenSequence(
            segment.split(/[^a-z0-9]+/).filter(Boolean),
            sequence,
        ),
    );
}

const COUNTER_EVIDENCE_CATEGORIES = new Set([
    "counter_evidence",
    "independent_analysis",
]);

const COMMERCIAL_TERM_PATH_TOKENS = [
    "eula",
    "terms",
    "agreement",
    "licensing",
    "subscription",
    "ordering",
];

const COMMERCIAL_TERM_PATH_SEQUENCES = [
    ["order", "management"],
    ["grant", "of", "use", "rights"],
    ["conditions", "of", "use"],
];

function hasCommercialTermsPath(canonicalUrl: string): boolean {
    const pathTokens = decodedPathTokens(canonicalUrl);
    return (
        hasAnyPathToken(pathTokens, COMMERCIAL_TERM_PATH_TOKENS) ||
        COMMERCIAL_TERM_PATH_SEQUENCES.some((sequence) =>
            hasPathTokenSequence(pathTokens, sequence),
        )
    );
}

function isCounterEvidenceIntent(candidate: SourceSelectionCandidate): boolean {
    return COUNTER_EVIDENCE_CATEGORIES.has(candidate.category);
}

function topicKey(candidate: SourceSelectionCandidate): string {
    try {
        const url = new URL(candidate.canonicalUrl);
        const path = url.pathname
            .split("/")
            .filter(Boolean)
            .slice(-2)
            .join("-")
            .replace(/[^a-z0-9-]+/gi, "-")
            .toLocaleLowerCase("en");
        return path || candidate.sourceId;
    } catch {
        return candidate.sourceId;
    }
}

function authorityTier(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
    host: string,
): SourceAuthorityTier {
    if (candidate.origin === "analyst_url") {
        return "analyst_supplied";
    }
    if (matchesHost(host, "sec.gov")) {
        return "regulator_primary";
    }
    const companyHost = company?.websiteUrl
        ? normalizedHost(company.websiteUrl)
        : "";
    const investorHost = company?.investorRelationsUrl
        ? normalizedHost(company.investorRelationsUrl)
        : "";
    if (companyHost && matchesHost(host, companyHost)) {
        return "company_primary";
    }
    if (
        investorHost &&
        matchesHost(host, investorHost) &&
        !registeredHost(host, IR_HOSTS)
    ) {
        return "company_primary";
    }
    if (registeredHost(host, IR_HOSTS)) {
        return "company_hosted_ir";
    }
    const capability = publisherCapability(host);
    if (capability) {
        return capability.authorityTier;
    }
    return "unverified";
}

function companyIdentity(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
    authority: SourceAuthorityTier,
):
    | "confirmed"
    | "discovery_metadata"
    | "conflict"
    | "unverified"
    | "not_evaluated" {
    if (candidate.origin === "analyst_url") {
        return "not_evaluated";
    }
    if (!company) {
        return "unverified";
    }
    if (authority === "company_primary") {
        return "confirmed";
    }
    if (authority === "regulator_primary") {
        const issuerCik = secIssuerCik(candidate);
        if (!issuerCik) {
            return "unverified";
        }
        return normalizedCik(issuerCik) === normalizedCik(company.cik)
            ? "confirmed"
            : "conflict";
    }
    if (candidateMatchesCompany(candidate, company)) {
        return "confirmed";
    }
    if (
        (authority === "company_hosted_ir" ||
            authority === "institutional_independent") &&
        titleMatchesCompanyDiscoveryMetadata(candidate, company)
    ) {
        return "discovery_metadata";
    }
    return "unverified";
}

function classifyDocument(
    candidate: SourceSelectionCandidate,
    authority: SourceAuthorityTier,
    host: string,
): SourceDocumentKind {
    const urlPathTokens = decodedPathTokens(candidate.canonicalUrl);
    const urlPathSegments = decodedPathSegments(candidate.canonicalUrl);
    if (
        hasSegmentTokenSequence(urlPathSegments, ["sec", "filings"]) ||
        hasSegmentTokenSequence(urlPathSegments, ["index", "htm"]) ||
        hasPathSegment(urlPathSegments, "filings") ||
        hasPathSegmentSequence(urlPathSegments, ["sf", "us"])
    ) {
        return "search_or_index";
    }
    if (
        hasPathSegment(urlPathSegments, "community") ||
        hasPathSegment(urlPathSegments, "forum")
    ) {
        return "community_content";
    }

    const form = inferredSecForm(candidate);
    if (authority === "regulator_primary") {
        if (ANNUAL_FORMS.has(form)) {
            return "regulatory_annual";
        }
        if (INTERIM_FORMS.has(form)) {
            return "regulatory_interim";
        }
        if (MATERIAL_FORMS.has(form)) {
            return "regulatory_material";
        }
        if (form === "DEF 14A") {
            return "regulatory_proxy";
        }
        if (OWNERSHIP_FORMS.has(form)) {
            return "regulatory_ownership";
        }
        if ([...REGISTRATION_FORMS].some((prefix) => form.startsWith(prefix))) {
            return "regulatory_registration";
        }
        return "regulatory_other";
    }

    if (authority === "institutional_independent") {
        return publisherCapability(host)?.documentKind ?? "news_reporting";
    }

    if (authority === "qualified_partner") {
        return publisherCapability(host)?.documentKind ?? "partner_evidence";
    }

    if (authority === "unverified") {
        if (
            !isCounterEvidenceIntent(candidate) ||
            registeredHost(host, EXCLUDED_PUBLISHER_HOSTS)
        ) {
            return "unknown";
        }
        return "unverified_counter_evidence";
    }

    if (authority !== "company_primary" && authority !== "company_hosted_ir") {
        return "unknown";
    }

    if (
        hasPathTokenSequence(urlPathTokens, ["financial", "results"]) ||
        hasPathTokenSequence(urlPathTokens, ["earnings", "release"]) ||
        (hasPathToken(urlPathTokens, "reports") &&
            hasAnyPathToken(urlPathTokens, [
                "first",
                "second",
                "third",
                "fourth",
            ]) &&
            hasPathToken(urlPathTokens, "quarter")) ||
        (hasPathToken(urlPathTokens, "results") &&
            hasAnyPathToken(urlPathTokens, [
                "news",
                "press",
                "releases",
                "newsroom",
            ])) ||
        (hasPathTokenSequence(urlPathTokens, ["doc", "financials"]) &&
            hasPathToken(urlPathTokens, "results"))
    ) {
        return "earnings_release";
    }
    if (
        hasPathToken(urlPathTokens, "presentation") ||
        hasPathTokenSequence(urlPathTokens, ["investor", "day"]) ||
        (hasPathTokenSequence(urlPathTokens, ["doc", "financials"]) &&
            hasAnyPathToken(urlPathTokens, ["q1", "q2", "q3", "q4"]))
    ) {
        return "investor_presentation";
    }
    if (
        hasPathToken(urlPathTokens, "transcript") ||
        hasPathTokenSequence(urlPathTokens, ["earnings", "call"])
    ) {
        return "earnings_transcript";
    }
    if (authority === "company_hosted_ir") {
        return "unknown";
    }
    if (
        hasAnyPathToken(urlPathTokens, ["security", "encryption", "privacy"]) ||
        hasPathTokenSequence(urlPathTokens, ["zero", "trust"]) ||
        hasPathTokenSequence(urlPathTokens, ["data", "protection"])
    ) {
        return "official_security_documentation";
    }
    if (hasPathToken(urlPathTokens, "pricing")) {
        return "official_pricing";
    }
    if (
        hasAnyPathToken(urlPathTokens, [
            "terms",
            "agreement",
            "licensing",
            "ordering",
        ]) ||
        (hasPathToken(urlPathTokens, "subscription") &&
            hasAnyPathToken(urlPathTokens, ["terms", "agreement", "order"]))
    ) {
        return "official_commercial_terms";
    }
    if (hasAnyPathToken(urlPathTokens, ["api", "integration", "developer"])) {
        return "official_integration_documentation";
    }
    if (
        hasAnyPathToken(urlPathTokens, ["docs", "documentation", "products"]) ||
        hasPathTokenSequence(urlPathTokens, ["now", "platform"])
    ) {
        return "official_product_documentation";
    }
    return "unknown";
}

function isSecurityTrustPath(canonicalUrl: string): boolean {
    const tokens = decodedPathTokens(canonicalUrl);
    return (
        hasPathToken(tokens, "trust") ||
        hasPathToken(tokens, "privacy") ||
        hasPathTokenSequence(tokens, ["data", "protection"])
    );
}

function familyFor(
    candidate: SourceSelectionCandidate,
    kind: SourceDocumentKind,
): ClassifiedCandidate["sourceFamily"] {
    if (candidate.origin === "analyst_url") {
        return "analyst_supplied";
    }
    if (kind.startsWith("regulatory_")) {
        return "regulatory";
    }
    if (
        [
            "earnings_release",
            "investor_presentation",
            "earnings_transcript",
        ].includes(kind)
    ) {
        return "investor_relations";
    }
    if (
        [
            "official_product_documentation",
            "official_integration_documentation",
        ].includes(kind)
    ) {
        return "official_product";
    }
    if (
        [
            "official_pricing",
            "official_commercial_terms",
            "partner_evidence",
        ].includes(kind)
    ) {
        return "official_commercial";
    }
    if (kind === "official_security_documentation") {
        return "official_security";
    }
    if (kind === "independent_analysis") {
        return "independent_analysis";
    }
    if (kind === "news_reporting") {
        return "counter_evidence";
    }
    if (kind === "unverified_counter_evidence") {
        return "counter_evidence";
    }
    return "unrecognized";
}

function contributionsFor(
    candidate: SourceSelectionCandidate,
    kind: SourceDocumentKind,
    family: ClassifiedCandidate["sourceFamily"],
    host: string,
): Array<string> {
    const topic = topicKey(candidate);
    const publishedDate = candidate.publishedAt
        ? new Date(candidate.publishedAt)
        : undefined;
    const publishedYear = publishedDate?.getUTCFullYear();
    const publishedQuarter = publishedDate
        ? `${publishedDate.getUTCFullYear()}-Q${Math.floor(publishedDate.getUTCMonth() / 3) + 1}`
        : undefined;
    if (candidate.origin === "analyst_url") {
        return [`analyst_supplied:${candidate.sourceId}`];
    }
    if (kind === "regulatory_annual") {
        return [
            "regulatory_annual",
            `regulatory_annual:${publishedYear ?? topic}`,
        ];
    }
    if (kind === "regulatory_interim") {
        return [
            "regulatory_interim",
            `regulatory_interim:${publishedQuarter ?? topic}`,
        ];
    }
    if (kind === "regulatory_material") {
        return [
            "regulatory_material_event",
            `regulatory_event:${candidate.secAccessionNumber ?? candidate.publishedAt ?? topic}`,
        ];
    }
    if (kind === "earnings_release") {
        return ["investor_results", `investor_results:${topic}`];
    }
    if (["investor_presentation", "earnings_transcript"].includes(kind)) {
        return ["investor_presentation", `investor_material:${topic}`];
    }
    if (kind === "official_product_documentation") {
        return ["official_product_platform", `official_product:${topic}`];
    }
    if (kind === "official_integration_documentation") {
        return ["official_product_integration", `official_product:${topic}`];
    }
    if (kind === "official_pricing") {
        return ["official_commercial_pricing", `official_commercial:${topic}`];
    }
    if (kind === "official_commercial_terms") {
        return ["official_commercial_terms", `official_commercial:${topic}`];
    }
    if (kind === "partner_evidence") {
        return [`commercial_partner:${host}:${topic}`];
    }
    if (kind === "official_security_documentation") {
        const role = isSecurityTrustPath(candidate.canonicalUrl)
            ? "official_security_trust"
            : "official_security_architecture";
        return [role, `official_security:${topic}`];
    }
    if (
        [
            "independent_analysis",
            "news_reporting",
            "unverified_counter_evidence",
        ].includes(kind)
    ) {
        return [
            family === "independent_analysis"
                ? `independent_analysis_publisher:${host}`
                : `counter_evidence_publisher:${host}`,
        ];
    }
    return [];
}

function eligibleCoverageRolesFor(
    candidate: SourceSelectionCandidate,
    authority: SourceAuthorityTier,
    documentKind: SourceDocumentKind,
    host: string,
): Array<SourceCoverageRole> {
    if (candidate.origin === "analyst_url") {
        return [];
    }
    if (authority === "regulator_primary") {
        if (documentKind === "regulatory_annual") {
            return ["regulatory_annual"];
        }
        if (documentKind === "regulatory_interim") {
            return ["regulatory_interim"];
        }
        if (documentKind === "regulatory_material") {
            return ["regulatory_material_event"];
        }
        return [];
    }
    if (authority === "company_primary" || authority === "company_hosted_ir") {
        const roleByDocumentKind: Partial<
            Record<SourceDocumentKind, SourceCoverageRole>
        > = {
            earnings_release: "investor_results",
            investor_presentation: "investor_presentation",
            earnings_transcript: "investor_presentation",
            official_product_documentation: "official_product_platform",
            official_integration_documentation: "official_product_integration",
            official_pricing: "official_commercial_pricing",
            official_commercial_terms: "official_commercial_terms",
            official_security_documentation: isSecurityTrustPath(
                candidate.canonicalUrl,
            )
                ? "official_security_trust"
                : "official_security_architecture",
        };
        const role = roleByDocumentKind[documentKind];
        return role ? [role] : [];
    }
    return [...(publisherCapability(host)?.eligibleCoverageRoles ?? [])];
}

function classifyMetadataCandidate(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
): ClassifiedCandidate {
    const host = normalizedHost(candidate.canonicalUrl);
    const authority = authorityTier(candidate, company, host);
    const identity = companyIdentity(candidate, company, authority);
    const documentKind = classifyDocument(candidate, authority, host);
    const sourceFamily = familyFor(candidate, documentKind);
    const declaredCoverageRoles = eligibleCoverageRolesFor(
        candidate,
        authority,
        documentKind,
        host,
    );
    const companyLinkageBasis: SourceCompanyLinkageBasis =
        identity === "confirmed"
            ? "structural"
            : identity === "conflict"
              ? "unverified"
              : identity;
    const eligibleCoverageRoles =
        companyLinkageBasis === "structural" ? declaredCoverageRoles : [];
    const coverageContributions =
        companyLinkageBasis === "discovery_metadata"
            ? []
            : contributionsFor(candidate, documentKind, sourceFamily, host);
    const recommendationContributions =
        companyLinkageBasis === "discovery_metadata"
            ? [
                  `company_linkage:discovery_metadata:${host}:${topicKey(candidate)}`,
              ]
            : [];
    if (!host) {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: false,
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            needsAttentionReason: "integrity_conflict",
        };
    }
    if (identity === "conflict") {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: false,
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            needsAttentionReason: "integrity_conflict",
        };
    }
    if (
        identity === "unverified" &&
        authority !== "unverified" &&
        authority !== "analyst_supplied"
    ) {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: false,
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            alternativeReason: "company_identity_unverified",
        };
    }
    if (documentKind === "search_or_index") {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: identity === "confirmed",
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            alternativeReason: "search_or_index",
        };
    }
    if (
        [
            "community_content",
            "regulatory_ownership",
            "regulatory_registration",
            "regulatory_proxy",
            "regulatory_other",
        ].includes(documentKind)
    ) {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: identity === "confirmed",
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            alternativeReason: "low_information_document",
        };
    }
    if (authority === "unverified") {
        const isInspectableCounterEvidence =
            Boolean(company && candidateMatchesCompany(candidate, company)) &&
            documentKind === "unverified_counter_evidence" &&
            coverageContributions.length > 0;
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: identity === "confirmed",
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            alternativeReason: isInspectableCounterEvidence
                ? "unverified_counter_evidence"
                : "unverified_publisher",
        };
    }
    if (
        authority === "qualified_partner" &&
        (eligibleCoverageRoles.length === 0 ||
            hasCommercialTermsPath(candidate.canonicalUrl))
    ) {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: identity === "confirmed",
            authorityTier: authority,
            companyLinkageBasis,
            documentKind,
            sourceFamily,
            coverageContributions,
            recommendationContributions,
            declaredCoverageRoles,
            eligibleCoverageRoles,
            eligible: false,
            alternativeReason: "qualified_partner_manual_review",
        };
    }
    return {
        ...candidate,
        host,
        companyIdentityConfirmed: identity === "confirmed",
        authorityTier: authority,
        companyLinkageBasis,
        documentKind,
        sourceFamily,
        coverageContributions,
        recommendationContributions,
        declaredCoverageRoles,
        eligibleCoverageRoles,
        eligible:
            coverageContributions.length > 0 ||
            recommendationContributions.length > 0 ||
            eligibleCoverageRoles.length > 0,
        alternativeReason:
            coverageContributions.length > 0 ||
            recommendationContributions.length > 0
                ? undefined
                : "no_new_coverage",
    };
}

/** Reuses source eligibility's host and company classifier for comparison context. */
export function classifySourceComparisonContext(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
) {
    const classified = classifyMetadataCandidate(candidate, company);
    return {
        authorityTier: classified.authorityTier,
        companyLinkageBasis: classified.companyLinkageBasis,
        companyIdentityConfirmed: classified.companyIdentityConfirmed,
        documentKind: classified.documentKind,
        coverageRole: classified.declaredCoverageRoles[0],
    };
}

/** Document kinds describe suitability for full coverage; narrower contributions can remain useful. */
export const SOURCE_ROLE_REQUIREMENTS: Readonly<
    Record<
        SourceCoverageRole,
        { documentKinds: readonly SourceDocumentKind[]; description: string }
    >
> = {
    regulatory_annual: {
        documentKinds: ["regulatory_annual"],
        description:
            "Annual issuer financial and business disclosures, such as Form 10-K. Ownership filings and future announcements do not qualify.",
    },
    regulatory_interim: {
        documentKinds: ["regulatory_interim"],
        description: "Interim issuer financial disclosures, such as Form 10-Q.",
    },
    regulatory_material_event: {
        documentKinds: ["regulatory_material"],
        description:
            "A material issuer event disclosed in a regulatory filing.",
    },
    investor_results: {
        documentKinds: ["earnings_release"],
        description:
            "An earnings announcement reporting actual financial results, not an event invitation or forecast alone.",
    },
    investor_presentation: {
        documentKinds: ["investor_presentation", "earnings_transcript"],
        description:
            "A substantive investor presentation or earnings discussion, not its event announcement or a listing page.",
    },
    official_product_platform: {
        documentKinds: ["official_product_documentation"],
        description:
            "A description of the company platform or product capabilities. Present product descriptions are assertions, not forecasts.",
    },
    official_product_integration: {
        documentKinds: [
            "official_product_documentation",
            "official_integration_documentation",
        ],
        description:
            "A description of integration, APIs, interoperability or extension mechanisms.",
    },
    official_commercial_pricing: {
        documentKinds: ["official_pricing"],
        description:
            "The company product subscription pricing or charging structure.",
    },
    official_commercial_terms: {
        documentKinds: ["official_commercial_terms", "partner_evidence"],
        description:
            "Operative subscription or service contractual terms for the company, not website terms or a contract-management product.",
    },
    official_security_architecture: {
        documentKinds: ["official_security_documentation"],
        description:
            "Technical descriptions of the company security or deployment architecture, not securities ownership.",
    },
    official_security_trust: {
        documentKinds: ["official_security_documentation"],
        description:
            "Security, compliance or trust documentation about the company products, not stock or securities disclosures.",
    },
    counter_evidence_primary: {
        documentKinds: [
            "independent_analysis",
            "news_reporting",
            "unverified_counter_evidence",
        ],
        description:
            "A specific adverse business mechanism, limitation or outcome concerning the company, including in a positive overall article.",
    },
    counter_evidence_secondary: {
        documentKinds: [
            "independent_analysis",
            "news_reporting",
            "unverified_counter_evidence",
        ],
        description:
            "Another adverse perspective or mechanism. This role does not certify independence.",
    },
    independent_analysis_primary: {
        documentKinds: ["independent_analysis"],
        description:
            "A substantive external author analysis of the company business or economics. This role does not certify factual truth or publisher independence.",
    },
    independent_analysis_secondary: {
        documentKinds: ["independent_analysis"],
        description:
            "Another substantive external author perspective. This role does not certify independence or corroboration.",
    },
};

/** Classifies one source using the same authority and qualification rules as corpus proposals. */
export function classifySourceCandidate(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
): ClassifiedCandidate {
    const base = classifyMetadataCandidate(candidate, company);
    const inspection = candidate.inspection;
    if (!inspection) return base;
    const qualification =
        inspection.status === "qualified"
            ? inspection.qualification
            : undefined;
    const subject =
        qualification?.companyMatch === "subject" &&
        base.needsAttentionReason !== "integrity_conflict";
    const kind = qualification?.documentKind ?? "unknown";
    const primary = [
        "regulator_primary",
        "company_primary",
        "company_hosted_ir",
    ].includes(base.authorityTier);
    const institutional = base.authorityTier === "institutional_independent";
    const documentaryCoverageRoles: SourceCoverageRole[] = [];
    const roleAvailability: SourceRoleAvailability[] =
        SOURCE_COVERAGE_ROLES.map((role) => {
            const fitsPurpose =
                SOURCE_ROLE_REQUIREMENTS[role].documentKinds.includes(kind);
            const unsuitablePurpose =
                !fitsPurpose &&
                (role.startsWith("regulatory_") ||
                    role.startsWith("investor_") ||
                    role === "official_commercial_terms");
            const lowInformation = [
                "regulatory_ownership",
                "regulatory_registration",
                "regulatory_proxy",
                "regulatory_other",
                "search_or_index",
            ].includes(kind);
            const roleFindings =
                subject && !unsuitablePurpose && !lowInformation
                    ? (qualification?.findings.filter(
                          (finding) => finding.role === role,
                      ) ?? [])
                    : [];
            const uses = roleFindings.map((finding) =>
                sourceFindingUsage(
                    finding,
                    "documentary",
                    inspection.status === "qualified"
                        ? inspection.comparisonOutcomes?.[
                              qualification?.findings.indexOf(finding) ?? -1
                          ]
                        : undefined,
                    qualification?.limitations,
                ),
            );
            const findings = roleFindings.filter(
                (_, index) => uses[index]?.usage !== "blocked",
            );
            const blockedReasons = [
                ...new Set(uses.flatMap((use) => use.reasonCodes)),
            ];
            if (!findings.length)
                return {
                    role,
                    state: "not_established",
                    reasonCodes: blockedReasons.length
                        ? blockedReasons
                        : [
                              inspection.status === "unavailable"
                                  ? inspection.reasonCode
                                  : !subject
                                    ? "company_not_established"
                                    : inspection.readingCompleteness ===
                                        "partial"
                                      ? "partial_reading"
                                      : "no_relevant_material",
                          ],
                    usage: "blocked",
                };
            const current = findings.filter((f) => f.period !== "historical");
            if (!current.length)
                return {
                    role,
                    state: "limited",
                    reasonCodes: ["historical"],
                    usage: "historical_only",
                };
            if (
                role === "official_commercial_terms" &&
                !current.some((f) => f.period === "current")
            )
                return {
                    role,
                    state: "limited",
                    reasonCodes: ["period_unestablished"],
                    usage: "verification_required",
                };
            const allowedAuthority = role.startsWith("regulatory_")
                ? base.authorityTier === "regulator_primary"
                : role.startsWith("official_") || role.startsWith("investor_")
                  ? primary
                  : institutional;
            if (allowedAuthority && fitsPurpose)
                documentaryCoverageRoles.push(role);
            const findingUsages = current.map(
                (f) =>
                    sourceFindingUsage(
                        f,
                        "documentary",
                        inspection?.status === "qualified"
                            ? inspection.comparisonOutcomes?.[
                                  qualification?.findings.indexOf(f) ?? -1
                              ]
                            : undefined,
                        qualification?.limitations,
                    ).usage,
            );
            const hasPossibleConflict = current.some((finding) => {
                const findingIndex =
                    qualification?.findings.indexOf(finding) ?? -1;
                return (
                    inspection?.status === "qualified" &&
                    inspection.comparisonOutcomes?.[findingIndex] ===
                        "possible_conflict"
                );
            });
            const needsComparison = current.some((finding) => {
                const findingIndex =
                    qualification?.findings.indexOf(finding) ?? -1;
                return (
                    sourceFindingRequiresComparison(finding) &&
                    (inspection?.status !== "qualified" ||
                        inspection.comparisonOutcomes?.[findingIndex] !==
                            "no_conflict_observed")
                );
            });
            if (!findingUsages.includes("documentary"))
                return {
                    role,
                    state: "limited",
                    reasonCodes: [
                        hasPossibleConflict
                            ? "possible_conflict"
                            : needsComparison
                              ? "comparison_required"
                              : findingUsages.includes(
                                      "attributed_argument_only",
                                  )
                                ? "unverified_assertion"
                                : "content_nature_uncertain",
                    ],
                    usage: findingUsages.includes("attributed_argument_only")
                        ? "attributed_argument_only"
                        : "verification_required",
                };
            if (!allowedAuthority)
                return {
                    role,
                    state: "limited",
                    reasonCodes: ["publisher_unverified"],
                    usage: "verification_required",
                };
            if (!fitsPurpose)
                return {
                    role,
                    state: "limited",
                    reasonCodes: ["document_scope_limited"],
                    usage: "documentary",
                };
            return {
                role,
                state: "available",
                reasonCodes: [],
                usage: "documentary",
            };
        });
    const useful = roleAvailability.filter(
        (role) => role.state !== "not_established",
    );
    // Reading failure removes content assurance, not independently established identity or discovery utility.
    const readingCannotExclude =
        inspection.status === "unavailable" ||
        (inspection.readingCompleteness === "partial" &&
            useful.length === 0 &&
            (qualification?.companyMatch === "subject" ||
                qualification?.companyMatch === "uncertain") &&
            ![
                "search_or_index",
                "regulatory_ownership",
                "regulatory_registration",
                "regulatory_proxy",
                "regulatory_other",
            ].includes(kind));
    if (
        readingCannotExclude &&
        base.eligible &&
        base.companyIdentityConfirmed &&
        base.needsAttentionReason !== "integrity_conflict"
    ) {
        return {
            ...base,
            eligibleCoverageRoles: [],
            declaredCoverageRoles: [],
            coverageContributions: [],
            recommendationContributions: [
                ...base.coverageContributions,
                ...base.recommendationContributions,
            ],
            roleAvailability,
            inspectionStatus:
                inspection.status === "unavailable"
                    ? "unavailable"
                    : inspection.readingCompleteness,
        };
    }
    const periodIdentity = periodicDocumentIdentity({
        ...base,
        documentKind: kind,
    });
    return {
        ...base,
        documentKind: kind,
        sourceFamily: familyFor(candidate, kind),
        companyIdentityConfirmed: Boolean(subject),
        companyLinkageBasis: subject
            ? base.companyLinkageBasis === "structural"
                ? "structural"
                : "inspected_content"
            : "unverified",
        documentaryCoverageRoles,
        eligibleCoverageRoles: roleAvailability
            .filter((role) => role.state === "available")
            .map((role) => role.role),
        declaredCoverageRoles: useful.map((role) => role.role),
        coverageContributions: useful.map(
            (role) => `content:${role.role}:${role.state}:${base.host}`,
        ),
        recommendationContributions:
            useful.length > 0 && periodIdentity ? [periodIdentity] : [],
        roleAvailability,
        inspectionStatus:
            inspection.status === "unavailable"
                ? "unavailable"
                : inspection.readingCompleteness,
        eligible:
            candidate.origin === "analyst_url"
                ? base.eligible
                : useful.length > 0,
        alternativeReason: !subject
            ? "company_identity_unverified"
            : kind === "search_or_index"
              ? "search_or_index"
              : "no_new_coverage",
    };
}

function compareCandidates(
    left: ClassifiedCandidate,
    right: ClassifiedCandidate,
    angleTokens: ReadonlySet<string>,
): number {
    const authorityDelta =
        AUTHORITY_PRIORITY[left.authorityTier] -
        AUTHORITY_PRIORITY[right.authorityTier];
    if (authorityDelta !== 0) {
        return authorityDelta;
    }
    const positionDelta =
        (left.providerResultPosition ?? Number.MAX_SAFE_INTEGER) -
        (right.providerResultPosition ?? Number.MAX_SAFE_INTEGER);
    if (positionDelta !== 0) {
        return positionDelta;
    }
    const recencyDelta = (right.publishedAt ?? 0) - (left.publishedAt ?? 0);
    if (recencyDelta !== 0) {
        return recencyDelta;
    }
    const leftTitle = new Set(normalizedTokens(left.title));
    const rightTitle = new Set(normalizedTokens(right.title));
    const leftMatches = [...angleTokens].filter((token) =>
        leftTitle.has(token),
    ).length;
    const rightMatches = [...angleTokens].filter((token) =>
        rightTitle.has(token),
    ).length;
    if (leftMatches !== rightMatches) {
        return rightMatches - leftMatches;
    }
    return (
        canonicalIdentity(left).localeCompare(canonicalIdentity(right), "en") ||
        left.sourceId.localeCompare(right.sourceId, "en")
    );
}

function canonicalIdentity(candidate: ClassifiedCandidate): string {
    try {
        const url = new URL(candidate.canonicalUrl);
        url.hash = "";
        url.hostname = url.hostname
            .toLocaleLowerCase("en")
            .replace(/^www\./, "");
        url.pathname = url.pathname.replace(/\/$/, "");
        for (const key of [...url.searchParams.keys()]) {
            if (
                key.toLocaleLowerCase("en").startsWith("utm_") ||
                ["gclid", "fbclid"].includes(key.toLocaleLowerCase("en"))
            ) {
                url.searchParams.delete(key);
            }
        }
        url.searchParams.sort();
        return url.toString();
    } catch {
        return candidate.canonicalUrl.trim();
    }
}

function secAccessionIdentity(
    candidate: ClassifiedCandidate,
): string | undefined {
    const explicit =
        candidate.secAccessionNumber ??
        (candidate.origin === "sec" ? candidate.providerReference : undefined);
    const normalizedExplicit = explicit?.replace(/[^0-9]/g, "");
    if (normalizedExplicit && normalizedExplicit.length >= 16) {
        return normalizedExplicit;
    }
    try {
        const archiveSegment = new URL(candidate.canonicalUrl).pathname.match(
            /\/Archives\/edgar\/data\/\d+\/(\d{16,20})(?:\/|$)/i,
        )?.[1];
        return archiveSegment;
    } catch {
        return undefined;
    }
}

function periodicDocumentIdentity(
    candidate: ClassifiedCandidate,
): string | undefined {
    const qualifiedPeriod =
        candidate.inspection?.status === "qualified"
            ? candidate.inspection.qualification.reportingPeriodEnd
            : undefined;
    if (candidate.inspection && !qualifiedPeriod) return undefined;
    const publishedDate = qualifiedPeriod
        ? new Date(`${qualifiedPeriod}T00:00:00.000Z`)
        : candidate.publishedAt
          ? new Date(candidate.publishedAt)
          : undefined;
    if (candidate.documentKind === "regulatory_annual") {
        const year = publishedDate?.getUTCFullYear();
        return year ? `regulatory_annual:${year}` : undefined;
    }
    if (candidate.documentKind === "regulatory_interim") {
        const period = publishedDate
            ? `${publishedDate.getUTCFullYear()}-q${Math.floor(publishedDate.getUTCMonth() / 3) + 1}`
            : undefined;
        return period ? `regulatory_interim:${period}` : undefined;
    }
    if (
        [
            "earnings_release",
            "investor_presentation",
            "earnings_transcript",
        ].includes(candidate.documentKind)
    ) {
        const period = publishedDate
            ? `${publishedDate.getUTCFullYear()}-q${Math.floor(publishedDate.getUTCMonth() / 3) + 1}`
            : undefined;
        return period ? `${candidate.documentKind}:${period}` : undefined;
    }
    return undefined;
}

function metadataIdentity(candidate: ClassifiedCandidate): string | undefined {
    const accession = secAccessionIdentity(candidate);
    if (accession) {
        return `sec_accession:${accession}`;
    }
    return periodicDocumentIdentity(candidate);
}

function preferAsDuplicateWinner(
    candidate: ClassifiedCandidate,
    current: ClassifiedCandidate,
): boolean {
    if (
        Boolean(candidate.requiresAnalystReview) !==
        Boolean(current.requiresAnalystReview)
    ) {
        return !candidate.requiresAnalystReview;
    }
    if (candidate.eligible !== current.eligible) {
        return candidate.eligible;
    }
    if (
        candidate.companyIdentityConfirmed !== current.companyIdentityConfirmed
    ) {
        return candidate.companyIdentityConfirmed;
    }
    return candidate.origin === "sec" && current.origin !== "sec";
}

function seriesCap(kind: SourceDocumentKind): number | undefined {
    if (kind === "regulatory_annual") return 2;
    if (kind === "regulatory_interim") return 2;
    if (kind === "regulatory_material") return 3;
    return undefined;
}

function candidateCapReached(
    candidate: ClassifiedCandidate,
    selected: ReadonlyArray<ClassifiedCandidate>,
    preset: CoveragePreset,
): boolean {
    const kindCap = seriesCap(candidate.documentKind);
    if (
        kindCap !== undefined &&
        selected.filter(
            ({ documentKind }) => documentKind === candidate.documentKind,
        ).length >= kindCap
    ) {
        return true;
    }
    if (
        ["counter_evidence", "independent_analysis"].includes(
            candidate.sourceFamily,
        ) &&
        selected.filter(({ sourceFamily }) =>
            ["counter_evidence", "independent_analysis"].includes(sourceFamily),
        ).length >= (preset === "independent_scrutiny" ? 6 : 4)
    ) {
        return true;
    }
    return (
        selected.filter(
            ({ sourceFamily }) => sourceFamily === candidate.sourceFamily,
        ).length >= familyCap(preset, candidate.sourceFamily)
    );
}

function roleMatches(
    candidate: Pick<
        ClassifiedCandidate,
        "eligibleCoverageRoles" | "host" | "sourceFamily"
    >,
    role: SourceCoverageRole,
    selected: ReadonlyArray<Pick<ClassifiedCandidate, "host" | "sourceFamily">>,
): boolean {
    if (!candidate.eligibleCoverageRoles.includes(role)) {
        return false;
    }
    if (role.startsWith("counter_evidence_")) {
        return !selected.some(
            (existing) =>
                ["counter_evidence", "independent_analysis"].includes(
                    existing.sourceFamily,
                ) && existing.host === candidate.host,
        );
    }
    if (role.startsWith("independent_analysis_")) {
        return !selected.some(
            (existing) =>
                existing.sourceFamily === "independent_analysis" &&
                existing.host === candidate.host,
        );
    }
    return true;
}

/** Projects current inclusion without changing immutable recommendation metadata. */
export function evaluateSourceCoverage<SourceId extends string>(
    preset: CoveragePreset,
    candidates: ReadonlyArray<{
        sourceId: SourceId;
        canonicalUrl: string;
        sourceFamily: SourceSelectionProposalResult["items"][number]["sourceFamily"];
        eligibleCoverageRoles: Array<SourceCoverageRole>;
        declaredCoverageRoles: Array<SourceCoverageRole>;
        duplicateOfSourceId?: string;
        included: boolean;
        decision?: Infer<typeof sourceDecisionValidator>;
        roleAvailability?: SourceRoleAvailability[];
        documentKind?: SourceDocumentKind;
    }>,
) {
    const selected: Array<(typeof candidates)[number] & { host: string }> = [];
    return requiredRoles(preset).map((role) => {
        const relevant = candidates.filter(
            (candidate) =>
                candidate.eligibleCoverageRoles.includes(role) ||
                candidate.declaredCoverageRoles.includes(role) ||
                (candidate.documentKind !== undefined &&
                    SOURCE_ROLE_REQUIREMENTS[role].documentKinds.includes(
                        candidate.documentKind,
                    )),
        );
        const best = candidates.find(
            (candidate) =>
                candidate.included &&
                !candidate.duplicateOfSourceId &&
                roleMatches(
                    {
                        ...candidate,
                        host: normalizedHost(candidate.canonicalUrl),
                    },
                    role,
                    selected,
                ),
        );
        if (best)
            selected.push({ ...best, host: normalizedHost(best.canonicalUrl) });
        const limits = relevant
            .filter(
                (candidate) =>
                    candidate.included && !candidate.duplicateOfSourceId,
            )
            .flatMap(
                (candidate) =>
                    candidate.roleAvailability
                        ?.filter(
                            (item) =>
                                item.role === role &&
                                item.state !== "available",
                        )
                        .flatMap((item) => item.reasonCodes) ?? [],
            );
        return {
            role,
            covered: Boolean(best),
            availability: best
                ? ("available" as const)
                : relevant.some(
                        (candidate) =>
                            candidate.included &&
                            !candidate.duplicateOfSourceId &&
                            candidate.roleAvailability?.some(
                                (item) =>
                                    item.role === role &&
                                    item.state === "limited",
                            ),
                    )
                  ? ("limited" as const)
                  : ("not_established" as const),
            reasonCodes: best
                ? []
                : [
                      ...new Set(
                          limits.length
                              ? limits
                              : relevant.some(
                                      (candidate) =>
                                          candidate.decision === "rejected",
                                  )
                                ? ["analyst_exclusion"]
                                : ["no_suitable_document"],
                      ),
                  ],
            candidateIds: relevant.map((candidate) => candidate.sourceId),
            relatedCandidateIds: candidates
                .filter(
                    (candidate) =>
                        candidate.sourceFamily === FAMILY_BY_ROLE[role] &&
                        !relevant.includes(candidate),
                )
                .map((candidate) => candidate.sourceId),
        };
    });
}

function familyCap(
    preset: CoveragePreset,
    family: ClassifiedCandidate["sourceFamily"],
): number {
    if (family === "regulatory") {
        return 7;
    }
    if (family === "counter_evidence" || family === "independent_analysis") {
        return preset === "independent_scrutiny" ? 6 : 4;
    }
    if (
        [
            "official_product",
            "official_commercial",
            "official_security",
        ].includes(family)
    ) {
        return 4;
    }
    return 4;
}

function legacyFamilyGaps(
    roles: ReadonlyArray<SourceCoverageRole>,
): Array<SourceFamily> {
    return [...new Set(roles.map((role) => FAMILY_BY_ROLE[role]))];
}

/** Describes the identity that selection actually compared, without promoting metadata to inspected evidence. */
function selectionContribution(
    candidate: ClassifiedCandidate,
    key: string,
): SourceSelectionRationale["contributions"][number] {
    const inspected =
        key.startsWith("content:") &&
        candidate.coverageContributions.includes(key);
    const role = SOURCE_COVERAGE_ROLES.find((role) =>
        inspected
            ? key.startsWith(`content:${role}:`)
            : key === role || key.startsWith(`${role}:`),
    );
    const reportingPeriodEnd =
        candidate.inspection?.status === "qualified"
            ? (candidate.inspection.qualification.reportingPeriodEnd ??
              undefined)
            : undefined;
    const inspectedPeriod =
        Boolean(reportingPeriodEnd) &&
        key === periodicDocumentIdentity(candidate);
    return {
        key,
        basis:
            inspected || inspectedPeriod
                ? "inspected_content"
                : "discovery_metadata",
        kind: inspected
            ? "documentary_role"
            : key.startsWith("regulatory_event:")
              ? "filing_candidate"
              : key.includes("_publisher:")
                ? "publisher"
                : inspectedPeriod ||
                    [
                        "regulatory_annual",
                        "regulatory_interim",
                        "investor_results",
                    ].some(
                        (prefix) =>
                            key === prefix || key.startsWith(`${prefix}:`),
                    )
                  ? "report_candidate"
                  : "document_candidate",
        ...(key.startsWith("regulatory_event:")
            ? { role: "regulatory_material_event" as const }
            : role
              ? { role }
              : {}),
        ...(inspectedPeriod && reportingPeriodEnd
            ? { reportingPeriodEnd }
            : {}),
    };
}

export function buildSourceSelectionProposal(input: {
    candidates: ReadonlyArray<SourceSelectionCandidate>;
    company?: SourceSelectionCompany;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
    rejectedSourceIds?: readonly string[];
    ceiling?: number;
    /** @deprecated v1 compatibility; use ceiling. */
    target?: number;
}): SourceSelectionProposalResult {
    const ceiling = Math.max(1, Math.floor(input.ceiling ?? input.target ?? 1));
    const angleTokens = new Set(normalizedTokens(input.researchAngle));
    const classified = input.candidates
        .map((candidate) => classifySourceCandidate(candidate, input.company))
        .sort(
            (left, right) =>
                Number(Boolean(left.requiresAnalystReview)) -
                    Number(Boolean(right.requiresAnalystReview)) ||
                compareCandidates(left, right, angleTokens),
        );

    const duplicateReasons = new Map<
        string,
        { reason: SourceSelectionReasonCode; duplicateOfSourceId: string }
    >();
    const canonicalWinners = new Map<string, ClassifiedCandidate>();
    const metadataWinners = new Map<string, ClassifiedCandidate>();
    for (const candidate of classified) {
        const canonicalKey = canonicalIdentity(candidate);
        const canonicalWinner = canonicalWinners.get(canonicalKey);
        if (canonicalWinner) {
            duplicateReasons.set(candidate.sourceId, {
                reason: "canonical_duplicate",
                duplicateOfSourceId: canonicalWinner.sourceId,
            });
            continue;
        }
        canonicalWinners.set(canonicalKey, candidate);
        const metadataKey = metadataIdentity(candidate);
        if (!metadataKey) {
            continue;
        }
        const metadataWinner = metadataWinners.get(metadataKey);
        if (metadataWinner) {
            if (preferAsDuplicateWinner(candidate, metadataWinner)) {
                for (const [sourceId, duplicate] of duplicateReasons) {
                    if (
                        duplicate.duplicateOfSourceId ===
                        metadataWinner.sourceId
                    ) {
                        duplicateReasons.set(sourceId, {
                            ...duplicate,
                            duplicateOfSourceId: candidate.sourceId,
                        });
                    }
                }
                duplicateReasons.set(metadataWinner.sourceId, {
                    reason: "metadata_duplicate",
                    duplicateOfSourceId: candidate.sourceId,
                });
                metadataWinners.set(metadataKey, candidate);
                continue;
            }
            duplicateReasons.set(candidate.sourceId, {
                reason: "metadata_duplicate",
                duplicateOfSourceId: metadataWinner.sourceId,
            });
            continue;
        }
        metadataWinners.set(metadataKey, candidate);
    }

    const selectable = classified.filter(
        (candidate) =>
            candidate.eligible &&
            !candidate.requiresAnalystReview &&
            !duplicateReasons.has(candidate.sourceId),
    );
    const selected: Array<ClassifiedCandidate> = [];
    const selections = new Map<
        string,
        {
            reason: SourceSelectionReasonCode;
            rationale: SourceSelectionRationale;
        }
    >();
    const selectedDiscoveryCount = () =>
        selected.filter(({ origin }) => origin !== "analyst_url").length;
    const select = (
        candidate: ClassifiedCandidate,
        reason: SourceSelectionReasonCode,
        rationale: SourceSelectionRationale,
        enforceCeiling = true,
    ) => {
        if (
            selections.has(candidate.sourceId) ||
            (enforceCeiling && selectedDiscoveryCount() >= ceiling)
        ) {
            return;
        }
        selected.push(candidate);
        selections.set(candidate.sourceId, { reason, rationale });
    };

    for (const candidate of selectable.filter(
        ({ origin }) => origin === "analyst_url",
    )) {
        select(
            candidate,
            "added_by_analyst",
            {
                version: 1,
                trigger: "analyst_reference",
                contributions: [],
            },
            false,
        );
    }

    const coverageGaps: Array<SourceCoverageRole> = [];
    const coverageSources: Array<ClassifiedCandidate> = [];
    for (const role of requiredRoles(input.coveragePreset)) {
        const included = selected.find((candidate) =>
            roleMatches(candidate, role, coverageSources),
        );
        if (included) {
            coverageSources.push(included);
            continue;
        }
        const best = selectable.find(
            (candidate) =>
                !selections.has(candidate.sourceId) &&
                roleMatches(candidate, role, coverageSources),
        );
        if (!best || selectedDiscoveryCount() >= ceiling) {
            coverageGaps.push(role);
            continue;
        }
        select(best, "required_coverage_role", {
            version: 1,
            trigger: "required_role",
            role,
            contributions: [],
        });
        coverageSources.push(best);
    }

    const covered = new Set(
        selected.flatMap((candidate) => [
            ...candidate.coverageContributions,
            ...candidate.recommendationContributions,
        ]),
    );
    for (const candidate of selectable) {
        if (selectedDiscoveryCount() >= ceiling) {
            break;
        }
        if (selections.has(candidate.sourceId)) {
            continue;
        }
        if (candidateCapReached(candidate, selected, input.coveragePreset)) {
            continue;
        }
        const contributions = [
            ...candidate.coverageContributions,
            ...candidate.recommendationContributions,
        ];
        const novel = contributions.some(
            (contribution) => !covered.has(contribution),
        );
        if (!novel) {
            continue;
        }
        select(
            candidate,
            candidate.roleAvailability?.every(
                (role) => role.state === "not_established",
            )
                ? "ranked_fill"
                : "additional_coverage",
            {
                version: 1,
                trigger: "distinct_contribution",
                contributions: [...new Set(contributions)]
                    .filter((key) => !covered.has(key))
                    .map((key) => selectionContribution(candidate, key)),
            },
        );
        for (const contribution of contributions) {
            covered.add(contribution);
        }
    }

    const selectedRank = new Map(
        selected.map((candidate, rank) => [candidate.sourceId, rank]),
    );
    const alternatives = classified
        .filter((candidate) => !selectedRank.has(candidate.sourceId))
        .sort((left, right) => compareCandidates(left, right, angleTokens));
    const ordered = [...selected, ...alternatives];
    let attentionConflictAssigned = false;
    const items = ordered.map((candidate, rank) => {
        const duplicate = duplicateReasons.get(candidate.sourceId);
        const selection = selections.get(candidate.sourceId);
        const selectionReason = selection?.reason;
        const needsAttentionReason = candidate.requiresAnalystReview
            ? ("targeted_search_review" as const)
            : candidate.needsAttentionReason;
        const needsAttention = Boolean(
            candidate.requiresAnalystReview ||
                (needsAttentionReason && !attentionConflictAssigned),
        );
        if (needsAttention) {
            attentionConflictAssigned = true;
        }
        const ceilingReached =
            !selectionReason &&
            candidate.eligible &&
            selectedDiscoveryCount() >= ceiling;
        return {
            sourceId: candidate.sourceId,
            disposition: selectionReason
                ? ("recommended" as const)
                : needsAttention
                  ? ("needs_attention" as const)
                  : ("alternative" as const),
            sourceFamily: candidate.sourceFamily,
            documentKind: candidate.documentKind,
            authorityTier: candidate.authorityTier,
            companyLinkageBasis: candidate.companyLinkageBasis,
            coverageContributions: candidate.coverageContributions,
            recommendationContributions: candidate.recommendationContributions,
            declaredCoverageRoles: candidate.declaredCoverageRoles,
            eligibleCoverageRoles: candidate.eligibleCoverageRoles,
            roleAvailability: candidate.roleAvailability,
            inspectionStatus: candidate.inspectionStatus,
            duplicateOfSourceId: duplicate?.duplicateOfSourceId,
            rank,
            reasonCodes: [
                selectionReason ??
                    needsAttentionReason ??
                    candidate.alternativeReason ??
                    duplicate?.reason ??
                    (ceilingReached
                        ? "recommendation_ceiling_reached"
                        : "no_new_coverage"),
            ],
            ...(selection ? { selectionRationale: selection.rationale } : {}),
        };
    });

    const documentarySources: Array<ClassifiedCandidate> = [];
    const rejectedSourceIds = new Set(input.rejectedSourceIds);
    const documentaryCoverageGaps = requiredRoles(input.coveragePreset).filter(
        (role) => {
            const match = selectable.find(
                (candidate) =>
                    !rejectedSourceIds.has(candidate.sourceId) &&
                    roleMatches(
                        {
                            ...candidate,
                            eligibleCoverageRoles:
                                candidate.documentaryCoverageRoles ??
                                candidate.eligibleCoverageRoles,
                        },
                        role,
                        documentarySources,
                    ),
            );
            if (!match) return true;
            documentarySources.push(match);
            return false;
        },
    );
    return {
        items,
        documentaryCoverageGaps,
        gaps: legacyFamilyGaps(coverageGaps),
        coverageGaps,
        counts: {
            recommended: items.filter(
                ({ disposition }) => disposition === "recommended",
            ).length,
            needsAttention: items.filter(
                ({ disposition }) => disposition === "needs_attention",
            ).length,
            alternative: items.filter(
                ({ disposition }) => disposition === "alternative",
            ).length,
        },
    };
}

/** Legal control permissions depend on the submitted documentary role, not wording or model preference. */
export function documentaryPermittedUses(
    kind: import("./sourcesContracts").DocumentaryContribution["kind"],
) {
    return kind === "forecast" || kind === "attributed_argument"
        ? (["attributed_argument_only", "context_only", "blocked"] as const)
        : ([
              "documentary",
              "attributed_argument_only",
              "context_only",
              "blocked",
          ] as const);
}

/** Interprets a controlled contribution for its declared use, independently of corpus membership. */
export function controlledDocumentaryUse(
    contribution: import("./sourcesContracts").DocumentaryContribution,
    control:
        | import("convex/values").Infer<
              typeof import("./sourcesContracts").documentaryControlValidator
          >
        | null,
    restrictions: readonly {
        contributionId: string;
        version: number;
        permittedUse?:
            | "documentary"
            | "attributed_argument_only"
            | "context_only"
            | "blocked";
    }[] = [],
): "documentary" | "attributed_argument_only" | "context_only" | "blocked" {
    const finding = control?.findings.find(
        (item) => item.contributionId === contribution.id,
    );
    if (finding?.conclusion !== "supported") return "blocked";
    if (
        !documentaryPermittedUses(contribution.kind).some(
            (use) => use === finding.permittedUse,
        )
    )
        return "blocked";
    let permittedUse = finding.permittedUse;
    for (const restriction of restrictions) {
        if (
            restriction.contributionId !== contribution.id ||
            restriction.version !== contribution.version
        )
            continue;
        const narrower = restriction.permittedUse ?? "blocked";
        if (permittedUse === "blocked" || narrower === "blocked")
            return "blocked";
        if (narrower === "documentary") continue;
        if (permittedUse === "documentary" || permittedUse === narrower)
            permittedUse = narrower;
        else return "blocked";
    }
    return permittedUse;
}
