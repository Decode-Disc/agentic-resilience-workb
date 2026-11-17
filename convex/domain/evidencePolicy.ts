import type { ClaimClassification } from "@convex/domain/claims";
import type {
    SourceAuthorityTier,
    SourceDocumentKind,
} from "@convex/domain/sourceSelectionPolicy";

export const POLICY_VERSION = "evidence-policy-v4";

export const POLICY_RULE_IDS = {
    AUTHORITY: "policy.authority",
    RECENCY: "policy.recency",
    CORROBORATION: "policy.corroboration",
    PASSAGE_DIVERSITY: "policy.passage_diversity",
    CLASSIFICATION: "policy.classification",
    COUNTER_EVIDENCE: "policy.counter_evidence",
    QUESTION_COVERAGE: "policy.question_coverage",
    SEMANTIC_CONFLICT: "policy.semantic_conflict",
} as const;

export type PolicyOutcome = "pass" | "needs_review" | "blocked";

export type PolicySourceInput = {
    sourceId: string;
    origin: "sec" | "exa" | "analyst_url";
    category: string;
    secForm?: string;
    authorityTier: SourceAuthorityTier;
    documentKind: SourceDocumentKind;
    /** Deterministic independent identity derived from the validated canonical URL hostname. */
    publisherIdentity: string;
    publishedAt?: number;
};

/**
 * Corroboration identity from validated provenance. Issuer documents share a CIK;
 * recognized institutional publishers use a hostname key. Without provenance,
 * this performs hostname normalization only. Structural collapse uses no external
 * ownership data: recognized multi-label public suffixes extend the kept
 * label span so real second-level registrable domains are not over-collapsed;
 * otherwise the controlling-domain key is the last two labels. Missing or
 * invalid hosts (and IP literals) yield undefined, which the policy treats
 * as non-independent (it can never contribute to a corroboration pass).
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
    "ac.uk",
    "co.uk",
    "gov.uk",
    "org.uk",
    "net.uk",
    "nhs.uk",
    "police.uk",
    "com.au",
    "net.au",
    "org.au",
    "edu.au",
    "gov.au",
    "co.nz",
    "net.nz",
    "org.nz",
    "ac.nz",
    "govt.nz",
    "co.jp",
    "ne.jp",
    "or.jp",
    "ac.jp",
    "go.jp",
    "com.br",
    "net.br",
    "org.br",
    "gov.br",
    "edu.br",
    "co.in",
    "net.in",
    "org.in",
    "gov.in",
    "ac.in",
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "co.kr",
    "or.kr",
    "go.kr",
    "ac.kr",
    "com.sg",
    "net.sg",
    "org.sg",
    "gov.sg",
    "com.hk",
    "org.hk",
    "gov.hk",
    "edu.hk",
    "com.mx",
    "org.mx",
    "gob.mx",
    "edu.mx",
    "co.za",
    "org.za",
    "gov.za",
    "ac.za",
    "com.tw",
    "org.tw",
    "gov.tw",
    "edu.tw",
    "com.tr",
    "org.tr",
    "gov.tr",
    "edu.tr",
    "gen.tr",
]);

export function derivePublisherIdentity(
    canonicalUrl: string,
    provenance?: { authorityTier: SourceAuthorityTier; issuerCik?: string },
): string | undefined {
    try {
        const hostname = new URL(canonicalUrl).hostname
            .toLocaleLowerCase("en")
            .replace(/^\.*www\./, "")
            .replace(/^\.+/, "");
        if (!hostname) return undefined;
        // Numeric/IP-literal hosts carry no registrable ownership signal;
        // treat them as missing identity rather than a fabricated publisher.
        if (
            hostname.includes(":") ||
            /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
            /^\d+$/.test(hostname)
        ) {
            return undefined;
        }
        if (provenance) {
            if (highAuthority.has(provenance.authorityTier)) {
                const cik = provenance.issuerCik;
                return cik && /^\d{1,10}$/.test(cik) && BigInt(cik) > 0n
                    ? `issuer:${BigInt(cik)}`
                    : undefined;
            }
            if (provenance.authorityTier !== "institutional_independent")
                return undefined;
        }
        const labels = hostname.split(".").filter(Boolean);
        if (labels.length === 1) return hostname;
        const suffix = labels.slice(-2).join(".");
        if (MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) && labels.length >= 3) {
            return labels.slice(-3).join(".");
        }
        return suffix;
    } catch {
        return undefined;
    }
}

export type PolicyNormalizedInputs = {
    classification: ClaimClassification;
    asOfTime: number;
    sources: PolicySourceInput[];
    supportingSourceIds: string[];
    supportingEvidenceCount: number;
    counterEvidenceCount: number;
    contextEvidenceCount: number;
    distinctSourceCount: number;
    distinctPublisherCount: number;
    distinctPassageCount: number;
    unresolvedCounterCount: number;
    coveredQuestionCount: number;
    totalQuestionCount: number;
    currentPlanQuestionCovered: boolean;
};

export type PolicyRuleResult = {
    ruleId: string;
    outcome: PolicyOutcome;
    reasonCode: string;
};

export type PolicyEvaluationResult = {
    policyVersion: typeof POLICY_VERSION;
    normalizedInputs: PolicyNormalizedInputs;
    rules: PolicyRuleResult[];
    result: PolicyOutcome;
    requiresVerifier: boolean;
    verifierRuleId?: typeof POLICY_RULE_IDS.SEMANTIC_CONFLICT;
};

const highAuthority = new Set<SourceAuthorityTier>([
    "regulator_primary",
    "company_primary",
    "company_hosted_ir",
]);

/** Deterministic policy over bounded, observable evidence characteristics. */
export function evaluateEvidencePolicy(
    inputs: PolicyNormalizedInputs,
): PolicyEvaluationResult {
    if (
        inputs.sources.length === 0 ||
        inputs.distinctPassageCount === 0 ||
        inputs.distinctSourceCount === 0
    ) {
        return {
            policyVersion: POLICY_VERSION,
            normalizedInputs: inputs,
            rules: [
                {
                    ruleId: POLICY_RULE_IDS.PASSAGE_DIVERSITY,
                    outcome: "blocked",
                    reasonCode: "no_cited_evidence",
                },
            ],
            result: "blocked",
            requiresVerifier: false,
        };
    }
    if (
        [
            inputs.supportingEvidenceCount,
            inputs.counterEvidenceCount,
            inputs.contextEvidenceCount,
            inputs.distinctSourceCount,
            inputs.distinctPublisherCount,
            inputs.distinctPassageCount,
            inputs.unresolvedCounterCount,
            inputs.coveredQuestionCount,
            inputs.totalQuestionCount,
        ].some((count) => !Number.isInteger(count) || count < 0) ||
        inputs.coveredQuestionCount > inputs.totalQuestionCount
    ) {
        throw new Error("Invalid policy counters");
    }

    const rules: PolicyRuleResult[] = [];
    const supportingIds = new Set(inputs.supportingSourceIds);
    const supportingSources = inputs.sources.filter((source) =>
        supportingIds.has(source.sourceId),
    );
    if (
        supportingIds.size > inputs.sources.length ||
        inputs.supportingSourceIds.some(
            (id) => !inputs.sources.some((source) => source.sourceId === id),
        )
    )
        throw new Error("Supporting source is absent from cited evidence");
    rules.push({
        ruleId: POLICY_RULE_IDS.AUTHORITY,
        outcome: supportingSources.some((source) =>
            highAuthority.has(source.authorityTier),
        )
            ? "pass"
            : "needs_review",
        reasonCode: supportingSources.some((source) =>
            highAuthority.has(source.authorityTier),
        )
            ? "high_authority_present"
            : "high_authority_absent",
    });

    const datedSources = supportingSources.filter(
        (source) => source.publishedAt !== undefined,
    );
    const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
    const anyFuture = datedSources.some(
        (source) => (source.publishedAt ?? 0) > inputs.asOfTime,
    );
    const anyCurrentDate = datedSources.some((source) => {
        const age = inputs.asOfTime - (source.publishedAt ?? 0);
        return age >= 0 && age <= twoYearsMs;
    });
    rules.push({
        ruleId: POLICY_RULE_IDS.RECENCY,
        outcome:
            datedSources.length > 0 && !anyFuture && anyCurrentDate
                ? "pass"
                : "needs_review",
        reasonCode:
            datedSources.length === 0
                ? "publication_date_unavailable"
                : anyFuture
                  ? "publication_date_future"
                  : anyCurrentDate
                    ? "publication_date_current"
                    : "publication_date_stale",
    });
    const corroboratingSources = supportingSources.filter(
        (source) =>
            highAuthority.has(source.authorityTier) ||
            source.authorityTier === "institutional_independent",
    );
    const independentPublisherCount = new Set(
        corroboratingSources
            .map((source) => source.publisherIdentity)
            .filter(Boolean),
    ).size;
    const hasMissingPublisherIdentity =
        corroboratingSources.length !== supportingSources.length ||
        supportingSources.some((source) => !source.publisherIdentity);
    rules.push({
        ruleId: POLICY_RULE_IDS.CORROBORATION,
        outcome: independentPublisherCount >= 2 ? "pass" : "needs_review",
        reasonCode:
            independentPublisherCount >= 2
                ? "distinct_publisher_corroboration"
                : hasMissingPublisherIdentity
                  ? "publisher_identity_unavailable"
                  : "single_publisher_only",
    });
    rules.push({
        ruleId: POLICY_RULE_IDS.PASSAGE_DIVERSITY,
        outcome: inputs.distinctPassageCount >= 2 ? "pass" : "needs_review",
        reasonCode:
            inputs.distinctPassageCount >= 2
                ? "multiple_passages"
                : "single_passage_only",
    });
    rules.push({
        ruleId: POLICY_RULE_IDS.CLASSIFICATION,
        outcome: inputs.classification === "Fact" ? "pass" : "needs_review",
        reasonCode: `classification_${inputs.classification.toLowerCase()}`,
    });
    rules.push({
        ruleId: POLICY_RULE_IDS.COUNTER_EVIDENCE,
        outcome: inputs.unresolvedCounterCount === 0 ? "pass" : "needs_review",
        reasonCode:
            inputs.unresolvedCounterCount === 0
                ? "no_unresolved_counter_evidence"
                : "unresolved_counter_evidence",
    });
    rules.push({
        ruleId: POLICY_RULE_IDS.QUESTION_COVERAGE,
        outcome:
            inputs.totalQuestionCount > 0 &&
            inputs.coveredQuestionCount === inputs.totalQuestionCount &&
            (inputs.classification !== "Unknown" ||
                inputs.currentPlanQuestionCovered)
                ? "pass"
                : "needs_review",
        reasonCode: inputs.currentPlanQuestionCovered
            ? "current_plan_question_covered"
            : "current_plan_question_not_covered",
    });

    const requiresVerifier =
        inputs.supportingEvidenceCount > 0 && inputs.counterEvidenceCount > 0;
    if (requiresVerifier) {
        rules.push({
            ruleId: POLICY_RULE_IDS.SEMANTIC_CONFLICT,
            outcome: "needs_review",
            reasonCode: "support_counter_semantic_conflict",
        });
    }

    return {
        policyVersion: POLICY_VERSION,
        normalizedInputs: inputs,
        rules,
        result: rules.some((rule) => rule.outcome === "blocked")
            ? "blocked"
            : rules.some((rule) => rule.outcome === "needs_review")
              ? "needs_review"
              : "pass",
        requiresVerifier,
        verifierRuleId: requiresVerifier
            ? POLICY_RULE_IDS.SEMANTIC_CONFLICT
            : undefined,
    };
}
