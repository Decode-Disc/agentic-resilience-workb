import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import { v } from "convex/values";
import type { ResearchPlanQuery } from "./researchPlan";
import { buildResearchPlan, type CoveragePreset } from "./researchPlan";
import { sha256Hex } from "./sourcePassages";
import { sourcePreparationError } from "./sourcePreparationAuthority";
import {
    FAMILY_BY_ROLE,
    sourceCoverageRoleValidator,
    sourceFamilyValidator,
    SOURCE_FAMILIES,
    type SourceCoverageRole,
    type SourceFamily,
    type SourceSelectionCompany,
} from "./sourceSelectionPolicy";

export const coverageRoleValidator = sourceCoverageRoleValidator;

/** Stored object key order cannot create another logical search or retry allowance. */
export function supplementalSearchInputHash(
    query: Omit<ResearchPlanQuery, "dimensionKeys" | "discoveryIntent"> & {
        dimensionKeys: string[];
        discoveryIntent?: string;
    },
) {
    return sha256Hex(
        JSON.stringify([
            query.query,
            query.category,
            query.discoveryIntent ?? null,
            query.includeDomains ?? [],
            query.dimensionKeys,
        ]),
    );
}

/** Retains historical first-attempt keys while identifying a separately reserved retry receipt. */
export function supplementalSearchOperationKey(
    supplementId: string,
    queryIndex: number,
    attempt = 1,
) {
    return `supplement:${supplementId}:query:${queryIndex}${attempt > 1 ? `:attempt:${attempt}` : ""}`;
}

/** Reads the same immutable query history for planning and atomic dispatch, including pre-hash receipts. */
export async function readSupplementalSearchAttempts(
    db: GenericDatabaseReader<DataModel>,
    runId: Id<"researchRuns">,
    supplement: Doc<"sourceSelectionProposalRebuilds">,
    queryIndex: number,
) {
    const query = supplement.supplementQueries?.[queryIndex];
    if (supplement.runId !== runId || !query)
        throw sourcePreparationError("supplement_invalid");
    const calls = await db
        .query("providerCalls")
        .withIndex("by_run_operation_input_and_attempt", (q) =>
            q
                .eq("runId", runId)
                .eq("operation", "source_supplement_search")
                .eq("inputHash", supplementalSearchInputHash(query)),
        )
        .take(3);
    const legacy = await db
        .query("providerCalls")
        .withIndex("by_operation_key", (q) =>
            q.eq(
                "operationKey",
                supplementalSearchOperationKey(supplement._id, queryIndex),
            ),
        )
        .first();
    if (legacy && !legacy.inputHash) {
        if (
            legacy.runId !== runId ||
            legacy.operation !== "source_supplement_search"
        )
            throw sourcePreparationError("supplement_invalid");
        calls.push(legacy);
    }
    return calls;
}
export const discoveryFamilyValidator = sourceFamilyValidator;
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
            queries: [
                ...(input.failedFamilies.includes("regulatory")
                    ? [
                          {
                              query: "Recent regulatory filings",
                              category: "regulatory",
                              discoveryIntent: "regulatory",
                              dimensionKeys: [],
                          },
                      ]
                    : []),
                ...queries.filter((query) =>
                    input.failedFamilies.includes(
                        query.discoveryIntent as SourceFamily,
                    ),
                ),
            ],
            families: input.failedFamilies,
        };
    }
    const role = input.target.role;
    const family = FAMILY_BY_ROLE[role];
    if (family === "regulatory")
        return {
            families: [family],
            queries: [
                {
                    query: ROLE_SEARCH_TERMS[role],
                    category: family,
                    discoveryIntent: family,
                    dimensionKeys: [],
                },
            ],
        };
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
        readonly retryAfterAt?: number,
    ) {
        super(code);
        this.name = "DiscoveryRequestError";
    }
}

/** Keeps provider diagnostics bounded and independent of raw messages or credentials. */
export function discoveryFailure(error: unknown) {
    if (error instanceof DiscoveryRequestError)
        return {
            code: error.code,
            retryable: error.retryable,
            retryAfterAt: error.retryAfterAt,
        };
    const name =
        error && typeof error === "object" && "name" in error
            ? error.name
            : undefined;
    if (name === "AbortError") return { code: "timeout", retryable: true };
    if (name === "TypeError") return { code: "network_error", retryable: true };
    return { code: "provider_error", retryable: false };
}
