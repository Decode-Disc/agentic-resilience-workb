import type { CoveragePreset } from "@convex/domain/researchPlan";

export const SOURCE_SELECTION_POLICY_VERSION = "source-selection-v2";
export const SOURCE_PUBLISHER_REGISTRY_VERSION = "source-publishers-v1";

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

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];
export type SourceCoverageRole = (typeof SOURCE_COVERAGE_ROLES)[number];
export type SourceDocumentKind = (typeof SOURCE_DOCUMENT_KINDS)[number];
export type SourceAuthorityTier = (typeof SOURCE_AUTHORITY_TIERS)[number];
export type SourceSelectionDisposition =
    | "recommended"
    | "needs_attention"
    | "alternative";
export type SourceSelectionReasonCode =
    | "added_by_analyst"
    | "required_family_coverage"
    | "ranked_fill"
    | "unrecognized_source_family"
    | "not_selected"
    | "required_coverage_role"
    | "additional_coverage"
    | "canonical_duplicate"
    | "metadata_duplicate"
    | "search_or_index"
    | "low_information_document"
    | "company_identity_unverified"
    | "unverified_publisher"
    | "no_new_coverage"
    | "recommendation_ceiling_reached"
    | "integrity_conflict";

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
    createdAt: number;
};

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
        coverageContributions: Array<string>;
        duplicateOfSourceId?: string;
        rank: number;
        reasonCodes: Array<SourceSelectionReasonCode>;
    }>;
    gaps: Array<SourceFamily>;
    coverageGaps: Array<SourceCoverageRole>;
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
    coverageContributions: Array<string>;
    host: string;
    companyIdentityConfirmed: boolean;
    eligible: boolean;
    alternativeReason?: SourceSelectionReasonCode;
    needsAttentionReason?: SourceSelectionReasonCode;
    duplicateOfSourceId?: string;
};

const IR_HOSTS = new Set([
    "q4cdn.com",
    "q4inc.com",
    "q4ir.com",
    "nasdaqomx.com",
]);
const INSTITUTIONAL_HOSTS = new Set([
    "reuters.com",
    "bloomberg.com",
    "ft.com",
    "wsj.com",
    "morningstar.com",
    "gartner.com",
    "forrester.com",
    "idc.com",
    "ftc.gov",
    "justice.gov",
]);
const PARTNER_HOSTS = new Set([
    "aws.amazon.com",
    "azuremarketplace.microsoft.com",
    "appsource.microsoft.com",
    "gsa.gov",
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

const FAMILY_BY_ROLE: Record<SourceCoverageRole, SourceFamily> = {
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
    const searchable = `${candidate.title} ${candidate.canonicalUrl}`
        .toLocaleLowerCase("en")
        .replace(/[^a-z0-9]+/g, "");
    const aliases = [
        company.legalName
            .toLocaleLowerCase("en")
            .replace(
                /\b(incorporated|inc|corp|corporation|holdings|limited|ltd|company)\b/g,
                "",
            )
            .replace(/[^a-z0-9]+/g, ""),
        normalizedHost(company.websiteUrl ?? "")
            .split(".")[0]
            ?.replace(/[^a-z0-9]+/g, "") ?? "",
    ].filter((alias) => alias.length >= 4);
    return aliases.some((alias) => searchable.includes(alias));
}

function containsAny(value: string, tokens: ReadonlyArray<string>): boolean {
    const normalized = value.toLocaleLowerCase("en");
    return tokens.some((token) => normalized.includes(token));
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
        return path || normalizedTokens(candidate.title).slice(0, 4).join("-");
    } catch {
        return normalizedTokens(candidate.title).slice(0, 4).join("-");
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
    if (registeredHost(host, INSTITUTIONAL_HOSTS)) {
        return "institutional_independent";
    }
    if (registeredHost(host, PARTNER_HOSTS)) {
        return "qualified_partner";
    }
    return "unverified";
}

function companyIdentity(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
    authority: SourceAuthorityTier,
): "confirmed" | "conflict" | "unverified" {
    if (candidate.origin === "analyst_url") {
        return "confirmed";
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
    if (
        authority === "company_hosted_ir" ||
        authority === "institutional_independent" ||
        authority === "qualified_partner"
    ) {
        return candidateMatchesCompany(candidate, company)
            ? "confirmed"
            : "unverified";
    }
    return "unverified";
}

function classifyDocument(
    candidate: SourceSelectionCandidate,
    authority: SourceAuthorityTier,
): SourceDocumentKind {
    const combined =
        `${candidate.title} ${candidate.canonicalUrl}`.toLocaleLowerCase("en");
    if (
        containsAny(combined, [
            "edgar search results",
            "edgar filing documents",
            "sec filings -",
            "sec-filings",
            "-index.htm",
            "/filings",
            "/sf/us/",
        ])
    ) {
        return "search_or_index";
    }
    if (
        containsAny(combined, [
            "/community/",
            "/forum/",
            " community",
            "solved:",
        ])
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
        return containsAny(combined, [
            "analysis",
            "risk",
            "competition",
            "competitor",
            "replacement",
            "research",
        ])
            ? "independent_analysis"
            : "news_reporting";
    }

    if (authority === "qualified_partner") {
        return "partner_evidence";
    }

    if (authority !== "company_primary" && authority !== "company_hosted_ir") {
        return "unknown";
    }

    if (
        containsAny(combined, [
            "financial results",
            "earnings release",
            "reports first quarter",
            "reports second quarter",
            "reports third quarter",
            "reports fourth quarter",
        ])
    ) {
        return "earnings_release";
    }
    if (containsAny(combined, ["presentation", "investor day"])) {
        return "investor_presentation";
    }
    if (containsAny(combined, ["transcript", "earnings call"])) {
        return "earnings_transcript";
    }
    if (authority === "company_hosted_ir") {
        return "unknown";
    }
    if (
        containsAny(combined, [
            "security",
            "encryption",
            "zero trust",
            "privacy",
            "data protection",
        ])
    ) {
        return "official_security_documentation";
    }
    if (containsAny(combined, ["pricing", "/pricing"])) {
        return "official_pricing";
    }
    if (
        containsAny(combined, [
            "terms",
            "agreement",
            "licensing",
            "subscription",
            "ordering",
            "order management",
        ])
    ) {
        return "official_commercial_terms";
    }
    if (
        containsAny(combined, [
            "product",
            "platform",
            "workflow",
            "documentation",
            "api",
            "integration",
        ])
    ) {
        return containsAny(combined, ["api", "integration", "developer"])
            ? "official_integration_documentation"
            : "official_product_documentation";
    }
    return "unknown";
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
        const role = containsAny(candidate.title, [
            "trust",
            "privacy",
            "data protection",
        ])
            ? "official_security_trust"
            : "official_security_architecture";
        return [role, `official_security:${topic}`];
    }
    if (["independent_analysis", "news_reporting"].includes(kind)) {
        return [
            family === "independent_analysis"
                ? `independent_analysis_publisher:${host}`
                : `counter_evidence_publisher:${host}`,
        ];
    }
    return [];
}

function classifyCandidate(
    candidate: SourceSelectionCandidate,
    company: SourceSelectionCompany | undefined,
): ClassifiedCandidate {
    const host = normalizedHost(candidate.canonicalUrl);
    const authority = authorityTier(candidate, company, host);
    const identity = companyIdentity(candidate, company, authority);
    const documentKind = classifyDocument(candidate, authority);
    const sourceFamily = familyFor(candidate, documentKind);
    const coverageContributions = contributionsFor(
        candidate,
        documentKind,
        sourceFamily,
        host,
    );
    if (!host) {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: false,
            authorityTier: authority,
            documentKind,
            sourceFamily,
            coverageContributions,
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
            documentKind,
            sourceFamily,
            coverageContributions,
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
            documentKind,
            sourceFamily,
            coverageContributions,
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
            documentKind,
            sourceFamily,
            coverageContributions,
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
            documentKind,
            sourceFamily,
            coverageContributions,
            eligible: false,
            alternativeReason: "low_information_document",
        };
    }
    if (authority === "unverified") {
        return {
            ...candidate,
            host,
            companyIdentityConfirmed: identity === "confirmed",
            authorityTier: authority,
            documentKind,
            sourceFamily,
            coverageContributions,
            eligible: false,
            alternativeReason: "unverified_publisher",
        };
    }
    return {
        ...candidate,
        host,
        companyIdentityConfirmed: identity === "confirmed",
        authorityTier: authority,
        documentKind,
        sourceFamily,
        coverageContributions,
        eligible: coverageContributions.length > 0,
        alternativeReason:
            coverageContributions.length > 0 ? undefined : "no_new_coverage",
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
    return left.sourceId.localeCompare(right.sourceId, "en");
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

function titlePeriodIdentity(title: string): string | undefined {
    const normalized = title.toLocaleLowerCase("en");
    const year = normalized.match(/\b(20\d{2})\b/)?.[1];
    const numericQuarter = normalized.match(/\bq([1-4])\b/)?.[1];
    const namedQuarter = ["first", "second", "third", "fourth"].findIndex(
        (name) => normalized.includes(`${name} quarter`),
    );
    const quarter =
        numericQuarter ??
        (namedQuarter >= 0 ? String(namedQuarter + 1) : undefined);
    return year && quarter ? `${year}-q${quarter}` : undefined;
}

function periodicDocumentIdentity(
    candidate: ClassifiedCandidate,
): string | undefined {
    const publishedDate = candidate.publishedAt
        ? new Date(candidate.publishedAt)
        : undefined;
    if (candidate.documentKind === "regulatory_annual") {
        const year =
            candidate.title.match(/\b(20\d{2})\b/)?.[1] ??
            publishedDate?.getUTCFullYear();
        return year ? `regulatory_annual:${year}` : undefined;
    }
    if (candidate.documentKind === "regulatory_interim") {
        const period =
            titlePeriodIdentity(candidate.title) ??
            (publishedDate
                ? `${publishedDate.getUTCFullYear()}-q${Math.floor(publishedDate.getUTCMonth() / 3) + 1}`
                : undefined);
        return period ? `regulatory_interim:${period}` : undefined;
    }
    if (
        [
            "earnings_release",
            "investor_presentation",
            "earnings_transcript",
        ].includes(candidate.documentKind)
    ) {
        const period =
            titlePeriodIdentity(candidate.title) ??
            (publishedDate
                ? `${publishedDate.getUTCFullYear()}-q${Math.floor(publishedDate.getUTCMonth() / 3) + 1}`
                : undefined);
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
    candidate: ClassifiedCandidate,
    role: SourceCoverageRole,
    selected: ReadonlyArray<ClassifiedCandidate>,
): boolean {
    if (candidate.coverageContributions.includes(role)) {
        return true;
    }
    if (role.startsWith("counter_evidence_")) {
        return (
            ["counter_evidence", "independent_analysis"].includes(
                candidate.sourceFamily,
            ) &&
            !selected.some(
                (existing) =>
                    ["counter_evidence", "independent_analysis"].includes(
                        existing.sourceFamily,
                    ) && existing.host === candidate.host,
            )
        );
    }
    if (role.startsWith("independent_analysis_")) {
        return (
            candidate.sourceFamily === "independent_analysis" &&
            !selected.some(
                (existing) =>
                    existing.sourceFamily === "independent_analysis" &&
                    existing.host === candidate.host,
            )
        );
    }
    return false;
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

export function buildSourceSelectionProposal(input: {
    candidates: ReadonlyArray<SourceSelectionCandidate>;
    company?: SourceSelectionCompany;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
    ceiling?: number;
    /** @deprecated v1 compatibility; use ceiling. */
    target?: number;
}): SourceSelectionProposalResult {
    const ceiling = Math.max(1, Math.floor(input.ceiling ?? input.target ?? 1));
    const angleTokens = new Set(normalizedTokens(input.researchAngle));
    const classified = input.candidates
        .map((candidate) => classifyCandidate(candidate, input.company))
        .sort((left, right) => compareCandidates(left, right, angleTokens));

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
            candidate.eligible && !duplicateReasons.has(candidate.sourceId),
    );
    const selected: Array<ClassifiedCandidate> = [];
    const selectedReason = new Map<string, SourceSelectionReasonCode>();
    const select = (
        candidate: ClassifiedCandidate,
        reason: SourceSelectionReasonCode,
    ) => {
        if (
            selectedReason.has(candidate.sourceId) ||
            selected.length >= ceiling
        ) {
            return;
        }
        selected.push(candidate);
        selectedReason.set(candidate.sourceId, reason);
    };

    for (const candidate of selectable.filter(
        ({ origin }) => origin === "analyst_url",
    )) {
        select(candidate, "added_by_analyst");
    }

    const coverageGaps: Array<SourceCoverageRole> = [];
    for (const role of requiredRoles(input.coveragePreset)) {
        const best = selectable.find(
            (candidate) =>
                !selectedReason.has(candidate.sourceId) &&
                roleMatches(candidate, role, selected),
        );
        if (!best || selected.length >= ceiling) {
            coverageGaps.push(role);
            continue;
        }
        select(best, "required_coverage_role");
    }

    const covered = new Set(
        selected.flatMap(({ coverageContributions }) => coverageContributions),
    );
    for (const candidate of selectable) {
        if (selected.length >= ceiling) {
            break;
        }
        if (selectedReason.has(candidate.sourceId)) {
            continue;
        }
        if (candidateCapReached(candidate, selected, input.coveragePreset)) {
            continue;
        }
        const novel = candidate.coverageContributions.some(
            (contribution) => !covered.has(contribution),
        );
        if (!novel) {
            continue;
        }
        select(candidate, "additional_coverage");
        for (const contribution of candidate.coverageContributions) {
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
        const selectionReason = selectedReason.get(candidate.sourceId);
        const needsAttentionReason = candidate.needsAttentionReason;
        const needsAttention = Boolean(
            needsAttentionReason && !attentionConflictAssigned,
        );
        if (needsAttention) {
            attentionConflictAssigned = true;
        }
        const ceilingReached =
            !selectionReason &&
            candidate.eligible &&
            selected.length >= ceiling;
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
            coverageContributions: candidate.coverageContributions,
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
        };
    });

    return {
        items,
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
