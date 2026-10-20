import { v } from "convex/values";
import { buildResearchPlan, type CoveragePreset } from "./researchPlan";
import {
    FAMILY_BY_ROLE,
    SOURCE_COVERAGE_ROLES,
    SOURCE_FAMILIES,
    type SourceCoverageRole,
    type SourceFamily,
    type SourceSelectionCompany,
} from "./sourceSelectionPolicy";

export const coverageRoleValidator = v.union(
    ...SOURCE_COVERAGE_ROLES.map((role) => v.literal(role)),
);
export const discoveryFamilyValidator = v.union(
    ...SOURCE_FAMILIES.map((family) => v.literal(family)),
);
export const recoveryTargetValidator = v.union(
    v.object({ kind: v.literal("failed_discovery") }),
    v.object({ kind: v.literal("coverage"), role: coverageRoleValidator }),
);
export const recoveryReasonValidator = v.union(
    v.literal("no_new_candidates"),
    v.literal("capacity_reached"),
    v.literal("cooldown"),
    v.literal("in_progress"),
    v.literal("unavailable"),
    v.literal("request_rejected"),
);
export type RecoveryTarget =
    | { kind: "failed_discovery" }
    | { kind: "coverage"; role: SourceCoverageRole };

const ROLE_SEARCH_TERMS: Record<SourceCoverageRole, string> = {
    regulatory_annual: "annual report 10-K",
    regulatory_interim: "quarterly report 10-Q",
    regulatory_material_event: "material event 8-K",
    investor_results: "quarterly earnings results release",
    investor_presentation: "investor presentation earnings transcript",
    official_product_platform: "product platform documentation",
    official_product_integration: "API integration documentation",
    official_commercial_pricing: "official pricing",
    official_commercial_terms: "official terms of service customer agreement",
    counter_evidence_primary:
        "independent analysis risks competitors replacement",
    counter_evidence_secondary:
        "independent analysis customer migration criticism",
    official_security_architecture: "security architecture documentation",
    official_security_trust: "trust security compliance",
    independent_analysis_primary: "independent industry analysis",
    independent_analysis_secondary: "independent customer analysis migration",
};

/** Derives recovery searches from the same confirmed-company and domain constraints as discovery. */
export function recoverySearchPlan(input: {
    company: SourceSelectionCompany;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
    target?: RecoveryTarget;
    failedFamilies: SourceFamily[];
}) {
    const queries = buildResearchPlan(input).queries;
    if (!input.target) return { queries, families: [...SOURCE_FAMILIES] };
    if (input.target.kind === "failed_discovery") {
        return {
            queries: queries.filter((query) =>
                input.failedFamilies.includes(
                    query.discoveryIntent as SourceFamily,
                ),
            ),
            families: input.failedFamilies,
        };
    }
    const role = input.target.role;
    const family = FAMILY_BY_ROLE[role];
    const template = queries.find((query) => query.discoveryIntent === family);
    return {
        families: [family],
        queries: template
            ? [
                  {
                      ...template,
                      query: `"${input.company.legalName}" ${input.company.ticker} ${ROLE_SEARCH_TERMS[role]}${input.researchAngle ? ` ${input.researchAngle.slice(0, 500)}` : ""}`,
                  },
              ]
            : [],
    };
}

export class DiscoveryRequestError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
    ) {
        super(code);
        this.name = "DiscoveryRequestError";
    }
}

/** Keeps provider diagnostics bounded and independent of raw messages or credentials. */
export function discoveryFailure(error: unknown) {
    if (error instanceof DiscoveryRequestError)
        return { code: error.code, retryable: error.retryable };
    const name =
        error && typeof error === "object" && "name" in error
            ? error.name
            : undefined;
    if (name === "AbortError") return { code: "timeout", retryable: true };
    if (name === "TypeError") return { code: "network_error", retryable: true };
    return { code: "provider_error", retryable: false };
}
