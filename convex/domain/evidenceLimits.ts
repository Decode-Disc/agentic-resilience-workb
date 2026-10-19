/**
 * Centralized string/payload bounds for policy evaluations and the bounded
 * deterministic verifier. Enforced at the verifier registration/execution
 * boundary and at the policy commit boundary before any row is written.
 * Keeping the ceilings here gives the shared responsibility a single owner.
 */

export const MAX_POLICY_RULE_ID_CHARS = 64;
export const MAX_POLICY_REASON_CODE_CHARS = 64;
export const MAX_POLICY_SOURCE_ID_CHARS = 128;
export const MAX_POLICY_SOURCE_CATEGORY_CHARS = 64;
export const MAX_POLICY_PUBLISHER_IDENTITY_CHARS = 128;
export const MAX_POLICY_SOURCE_SEC_FORM_CHARS = 64;
export const MAX_POLICY_INPUT_HASH_CHARS = 128;
export const MAX_VERIFIER_STATEMENT_CHARS = 1000;
export const MAX_VERIFIER_REFERENCE_IDENTITY_CHARS = 256;
export const MAX_VERIFIER_INPUT_HASH_CHARS = 128;

// Shared cap on verifier output evidence reference arrays, enforced at both
// the adapter boundary and the policy commit boundary before any insert.
export const MAX_VERIFIER_EVIDENCE_REFERENCES = 32;

/** Throws when a string is longer than the configured ceiling for its field. */
export function assertWithinLength(
    value: string,
    max: number,
    label: string,
): void {
    if (typeof value !== "string" || value.length > max) {
        throw new Error(`${label} exceeds upper bound of ${max} chars`);
    }
}
