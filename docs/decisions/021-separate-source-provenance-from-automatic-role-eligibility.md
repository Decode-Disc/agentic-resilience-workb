# ADR-021: Separate Source Provenance from Automatic Role Eligibility

## Status

Amended on 2026-10-20 by [ADR-024](024-qualify-source-content-before-corpus-approval.md). Its explicitly listed preparation, qualification and evidence-use clauses supersede the corresponding historical clauses below; all other decisions remain in force.

Accepted; supersedes ADR-020; company-linkage recommendation clauses partially superseded by ADR-022

## Date

2026-08-15

## Context

ADR-020 correctly identified that the fixed publisher whitelist made useful counter-evidence invisible to the analyst. Its remedy was incorrect: it let unverified counter-evidence fill the `counter_evidence_primary` and `counter_evidence_secondary` roles automatically and treated qualified reseller terms as canonical publisher terms.

That conflated three distinct facts:

1. discovery intent describes why a candidate was found;
2. provenance authority describes who published it;
3. automatic role eligibility describes which coverage role, if any, the system may fill without human judgment.

Neither discovery intent nor a title containing terms such as `analysis`, `risk`, `pricing`, or `security` is sufficient evidence for automatic role eligibility. The previous approach could therefore make a useful but unverified source conceal a required coverage gap before an analyst had read it. It also allowed a reseller EULA copy to stand in for canonical publisher commercial terms.

The workbench must preserve inspectable leads and counter-evidence while keeping role coverage and recommendation integrity explicit, deterministic, and auditable before the corpus-approval checkpoint.

## Decision

Replace `source-selection-v3` with `source-selection-v4` and `source-publishers-v2` with `source-publishers-v3`.

1. The publisher registry declares authority, document kind, and `eligibleCoverageRoles` as separate fields. The policy fills a required role only when that exact role is declared on the candidate. Family membership and coverage contributions no longer imply role eligibility.
2. A non-denylisted, company-matched source discovered for counter-evidence remains an inspectable `alternative` with authority `unverified`, document kind `unverified_counter_evidence`, and no eligible coverage roles. It cannot fill a coverage gap or be automatically recommended.
3. A qualified reseller remains identifiable as `qualified_partner`. A qualified partner without a declared coverage role, including terms-shaped reseller material, remains inspectable for manual review but cannot be automatically selected through a generic contribution. Canonical `official_commercial_terms` remains reserved for authority-compatible publisher material.
4. Titles are optional ranking signals only. They cannot establish company identity, document classification, role eligibility, duplicate identity, or a coverage contribution. External company identity uses either the exact website-domain label or the complete normalized legal-name sequence in the decoded URL path; it never uses query parameters, partial-token matches, or a generic legal-name word alone. Automatic document classification uses structured SEC metadata or explicit decoded URL-path tokens and approved path sequences; arbitrary URL substrings cannot make a generic page pricing, security, product, integration, or independent-analysis evidence.
5. New immutable proposal items persist `eligibleCoverageRoles`. The schema field is optional so historical proposal items remain readable with the safe fallback `[]`. Existing active drafts become outdated through the policy-version change and require the existing explicit rebuild flow.
6. Every valid analyst-supplied source is recommended before the ceiling is applied; the discovery recommendation ceiling counts only automatically discovered candidates.

## Alternatives Considered

### Let every company-matched independent source fill counter-evidence roles

- Pros: closes balanced-preset gaps quickly.
- Cons: lets unverified material satisfy a mandatory role before review and makes a recommendation look stronger than its provenance.
- Rejected: analyst approval is a checkpoint, not a reason to hide the system's uncertainty.

### Extend a denylist of poor publishers

- Pros: small incremental change.
- Cons: cannot define the positive authority and role boundary, requires perpetual maintenance, and does not solve reseller or title-derived classifications.
- Rejected: a capability registry provides the needed positive, reviewable contract.

### Use source titles to determine genre and role

- Pros: works on sparse discovery metadata.
- Cons: titles are unverified snippets and can describe a page without establishing its content or publisher authority.
- Rejected: titles remain useful for ordering but cannot establish automatic evidence coverage.

### Retrieve source content before corpus approval

- Pros: could validate source genre more accurately.
- Cons: violates the mandatory approval boundary and increases pre-approval retrieval, security, and cost exposure.
- Rejected: content validation begins only after an analyst approves a corpus.

## Consequences

- The analyst can still inspect useful unverified counter-evidence and reseller material, but visible coverage gaps remain until an authority-eligible source is present or the analyst makes an explicit decision in a later corpus revision.
- Automatic recommendations are narrower: the frozen corpus benchmark moves from 56 to 35 recommendations, retains all 34 authority-supported typed obligations, and reports zero classification mismatches for manual-review cases.
- Proposal history becomes more auditable because the exact role capability used by v4 is persisted rather than reconstructed from family or title heuristics. Canonical URLs, SEC accessions, and stable provider-owned metadata support duplicate handling; matching title text alone does not.
- The policy remains deterministic and metadata-only. It adds no provider call, retrieval, or pre-approval document processing.

## Supersession

ADR-021 supersedes ADR-020 in full. ADR-022 supersedes only ADR-021's requirement that every automatic recommendation use structural URL-path company linkage and its blanket prohibition on using titles for company-linkage triage. ADR-021 remains authoritative for publisher provenance, document classification, duplicate identity, automatic role eligibility, coverage-gap integrity, qualified-partner handling, and the prohibition on treating titles as evidence or content proof. ADR-018 remains authoritative for immutable proposal history, duplicate handling, caps, the recommendation ceiling, rebuild fencing, and the durable human checkpoint.