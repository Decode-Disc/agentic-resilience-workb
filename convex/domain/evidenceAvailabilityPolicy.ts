export type EvidenceAvailabilityInput = {
    secFilingCount: number;
    investorRelationsPresent: boolean;
    manualCandidateCount: number;
};

export type EvidenceAvailabilityEvaluation = EvidenceAvailabilityInput & {
    policyVersion: 'public-evidence-v1';
    outcome: 'sufficient' | 'insufficient';
    reasons: ReadonlyArray<'no_public_evidence_candidates'>;
};

/**
 * Determines whether at least one authoritative or analyst-supplied public
 * source candidate exists. It does not assess claim quality or confidence.
 */
export function evaluatePublicEvidenceAvailability(
    input: EvidenceAvailabilityInput,
): EvidenceAvailabilityEvaluation {
    const normalized = {
        secFilingCount: Math.max(0, Math.floor(input.secFilingCount)),
        investorRelationsPresent: input.investorRelationsPresent,
        manualCandidateCount: Math.max(
            0,
            Math.floor(input.manualCandidateCount),
        ),
    };
    const sufficient =
        normalized.secFilingCount > 0 ||
        normalized.investorRelationsPresent ||
        normalized.manualCandidateCount > 0;
    return {
        policyVersion: 'public-evidence-v1',
        ...normalized,
        outcome: sufficient ? 'sufficient' : 'insufficient',
        reasons: sufficient ? [] : ['no_public_evidence_candidates'],
    };
}
