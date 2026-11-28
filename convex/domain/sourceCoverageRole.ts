import { v } from "convex/values";
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

export const sourceCoverageRoleValidator = v.union(
    ...SOURCE_COVERAGE_ROLES.map((value) => v.literal(value)),
);
