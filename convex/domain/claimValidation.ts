/**
 * Structural validation for claims. Non-overridable, pure, deterministic.
 * Blocks invalid locator/replay, non-active-corpus passage, non-accepted
 * decision, missing evidence, schema violations, and invalid Unknown semantics.
 * A verifier never overrides a structural block.
 */

import type { Id } from "@convex/_generated/dataModel";
import type {
    ClaimClassification,
    EvidenceRelation,
} from "@convex/domain/claims";
import { CLAIM_CLASSIFICATIONS } from "@convex/domain/claims";
import type { AssessmentDimensionKey } from "@convex/domain/researchPlan";
import { ASSESSMENT_DIMENSION_KEYS } from "@convex/domain/researchPlan";

export type StructuralValidationResult =
    | { status: "valid" }
    | { status: "blocked"; reason: string; ruleId: string };

export type ClaimEvidenceInput = {
    sourcePassageId: Id<"sourcePassages">;
    passageKey: string;
    quotationHash: string;
    sourceVersionHash?: string;
    relation: EvidenceRelation;
};

export type ClaimDimensionLinkInput = {
    dimensionKey: AssessmentDimensionKey;
    rationale?: string;
};

export type ClaimStructuralInput = {
    statement: string;
    classification: ClaimClassification;
    evidence: ClaimEvidenceInput[];
    dimensionLinks: ClaimDimensionLinkInput[];
    researchPlanQuestionId?: Id<"researchPlanQuestions">;
    currentQuestionIds?: ReadonlySet<Id<"researchPlanQuestions">>;
    questionKey?: string;
};

export const STRUCTURAL_RULE_IDS = {
    INVALID_CLASSIFICATION: "structural.invalid_classification",
    EMPTY_STATEMENT: "structural.empty_statement",
    MISSING_EVIDENCE: "structural.missing_evidence",
    INVALID_EVIDENCE_RELATION: "structural.invalid_evidence_relation",
    INVALID_DIMENSION_KEY: "structural.invalid_dimension_key",
    UNKNOWN_MISSING_QUESTION: "structural.unknown_missing_question",
    UNKNOWN_MISSING_CONTEXT_EVIDENCE:
        "structural.unknown_missing_context_evidence",
    QUESTION_NOT_CURRENT: "structural.question_not_current",
    DUPLICATE_EVIDENCE: "structural.duplicate_evidence",
    PASSAGE_NOT_ACTIVE: "structural.passage_not_active",
    SOURCE_NOT_ACCEPTED: "structural.source_not_accepted",
    SOURCE_VERSION_NOT_CURRENT: "structural.source_version_not_current",
    SOURCE_AUTHORITY_MISSING: "source_authority_missing",
    SOURCE_STATUS_NOT_TERMINAL: "source_status_not_terminal",
    ARTIFACT_MISSING: "structural.artifact_missing",
    QUOTATION_NOT_REPRODUCIBLE: "structural.quotation_not_reproducible",
} as const;

const VALID_CLASSIFICATIONS = new Set<string>(CLAIM_CLASSIFICATIONS);
const VALID_RELATIONS = new Set(["supporting", "counter", "context"]);
const VALID_DIMENSIONS = new Set<string>(ASSESSMENT_DIMENSION_KEYS);

/**
 * Validates a single claim's structural invariants.
 * Returns "valid" or "blocked" with a reason and rule ID.
 * This is immutable policy: no overrides allowed.
 */
export function validateClaimStructure(
    claim: ClaimStructuralInput,
): StructuralValidationResult {
    // 1. Classification must be valid
    if (!VALID_CLASSIFICATIONS.has(claim.classification)) {
        return {
            status: "blocked",
            reason: `Invalid classification "${claim.classification}"`,
            ruleId: STRUCTURAL_RULE_IDS.INVALID_CLASSIFICATION,
        };
    }

    // 2. Statement must be non-empty
    if (!claim.statement || claim.statement.trim().length === 0) {
        return {
            status: "blocked",
            reason: "Claim statement is empty",
            ruleId: STRUCTURAL_RULE_IDS.EMPTY_STATEMENT,
        };
    }

    // 3. Must have at least one evidence passage
    if (!claim.evidence || claim.evidence.length === 0) {
        return {
            status: "blocked",
            reason: "Claim has no evidence passages",
            ruleId: STRUCTURAL_RULE_IDS.MISSING_EVIDENCE,
        };
    }

    // 4. All evidence relations must be valid
    for (const ev of claim.evidence) {
        if (!VALID_RELATIONS.has(ev.relation)) {
            return {
                status: "blocked",
                reason: `Invalid evidence relation "${ev.relation}"`,
                ruleId: STRUCTURAL_RULE_IDS.INVALID_EVIDENCE_RELATION,
            };
        }
    }

    // 5. All dimension keys must be valid
    for (const link of claim.dimensionLinks) {
        if (!VALID_DIMENSIONS.has(link.dimensionKey)) {
            return {
                status: "blocked",
                reason: `Invalid assessment dimension key "${link.dimensionKey}"`,
                ruleId: STRUCTURAL_RULE_IDS.INVALID_DIMENSION_KEY,
            };
        }
    }

    // 6. Duplicate evidence check
    const seenEvidenceKeys = new Set<string>();
    for (const ev of claim.evidence) {
        const key = `${ev.sourcePassageId}:::${ev.relation}`;
        if (seenEvidenceKeys.has(key)) {
            return {
                status: "blocked",
                reason: `Duplicate evidence passage ${ev.sourcePassageId} with relation ${ev.relation}`,
                ruleId: STRUCTURAL_RULE_IDS.DUPLICATE_EVIDENCE,
            };
        }
        seenEvidenceKeys.add(key);
    }

    // 7. Unknown claims require a researchPlanQuestionId and at least one context evidence
    if (claim.classification === "Unknown") {
        if (!claim.researchPlanQuestionId) {
            return {
                status: "blocked",
                reason: "Unknown claim must reference a research plan question",
                ruleId: STRUCTURAL_RULE_IDS.UNKNOWN_MISSING_QUESTION,
            };
        }

        const hasContext = claim.evidence.some(
            (ev) => ev.relation === "context",
        );
        if (!hasContext) {
            return {
                status: "blocked",
                reason: "Unknown claim must have at least one context evidence passage",
                ruleId: STRUCTURAL_RULE_IDS.UNKNOWN_MISSING_CONTEXT_EVIDENCE,
            };
        }
    }

    // 8. When the current plan is known, a question ID that is not part of it is stale
    if (
        claim.researchPlanQuestionId &&
        claim.currentQuestionIds &&
        !claim.currentQuestionIds.has(claim.researchPlanQuestionId)
    ) {
        return {
            status: "blocked",
            reason: "Claim references a research plan question that is not in the current plan",
            ruleId: STRUCTURAL_RULE_IDS.QUESTION_NOT_CURRENT,
        };
    }

    return { status: "valid" };
}

/**
 * Derives question coverage from structurally valid claims.
 * Returns a map of questionId -> count of valid claims referencing it.
 * Does not mutate question rows.
 */
export function deriveQuestionCoverage(
    claims: Array<{
        classification: ClaimClassification;
        researchPlanQuestionId?: Id<"researchPlanQuestions">;
    }>,
): Map<Id<"researchPlanQuestions">, number> {
    const coverage = new Map<Id<"researchPlanQuestions">, number>();

    for (const claim of claims) {
        if (claim.researchPlanQuestionId) {
            const current = coverage.get(claim.researchPlanQuestionId) ?? 0;
            coverage.set(claim.researchPlanQuestionId, current + 1);
        }
    }

    return coverage;
}
