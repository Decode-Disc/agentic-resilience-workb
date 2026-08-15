# Source Selection Company Linkage Design

## Status

Validated on 2026-08-15. This document defines the design decision only; production implementation remains separately authorized.

## Problem

The `source-selection-v4` policy requires structural company identity before an externally hosted source can be recommended. This correctly prevents query parameters, partial tokens, generic legal-name words, titles, and discovery categories from silently closing automatic coverage gaps. It is too restrictive for a narrow class of useful candidates whose publisher authority is known but whose URL is opaque, including shared investor-relations documents and institutional analysis whose company attribution is present only in discovery metadata.

The current policy makes one structural proof decide both whether a source is worth including in the proposed corpus and whether it may automatically satisfy a required coverage role. Those decisions have different risk. A candidate may be valuable enough to retrieve after analyst corpus approval without being strong enough to hide a missing automatic role before that approval.

The frozen 110-candidate corpus confirms the practical gap. A strict title-attribution probe identifies two in-scope candidates currently deferred by structural URL matching: an opaque Q4-hosted ServiceNow annual report and a Morningstar analysis explicitly naming ServiceNow. The same probe also identifies an AWS Marketplace result, which remains outside the selected publisher scope because qualified partners are not admitted by this design.

## Goals

- Recommend narrowly attributed institutional and shared-IR sources by default when discovery metadata explicitly links them to the selected company.
- Preserve visible automatic coverage gaps until structural company linkage exists.
- Keep publisher authority, document capability, company linkage, recommendation disposition, and analyst decision as separate durable concepts.
- Preserve the existing corpus-approval checkpoint and normal post-approval retrieval and provenance validation flow.
- Keep the policy deterministic, metadata-only, provider-agnostic at the domain boundary, and proportional to the prototype.

## Non-Goals

- Treat a discovery title as canonical company identity.
- Use titles to classify document kind, establish duplicate identity, determine a coverage contribution, or satisfy an automatic role.
- Add a second analyst checkpoint before extraction.
- Admit qualified partners or unverified publishers through metadata attribution.
- Retrieve content or call another provider before corpus approval.
- Reclassify historical approved corpus revisions.

## Evidence and Assumptions

### Verified

- A proposal item can be `recommended` while `eligibleCoverageRoles` is empty; current composition and benchmark contracts require a distinct contribution, not an automatic role.
- Approving the proposed corpus automatically accepts pending recommended sources, while alternatives remain pending unless the analyst explicitly includes them.
- The current Exa discovery adapter persists URL, title, publication date, provider result ID, and provider result position, but no structured company identifier.
- No separate post-approval company-linkage checkpoint currently exists.
- The two targeted corpus cases are an institutional publisher and a shared IR host; the qualified-partner match is separable by authority tier.

### Falsified

- `providerReference` is not a provider-owned company identity. It is the Exa result ID in the current discovery contract.
- Exact title attribution cannot be described as publisher-verified attribution because the repository does not establish that the title originates from canonical publisher metadata rather than provider-normalized discovery metadata.

### Unresolved

- The general false-positive rate of strict discovery-title attribution outside the frozen corpus has not been measured. The design therefore limits the signal to a positive host registry and uses exact normalized tokens only.
- A future provider may expose structured company identity. That would justify a stronger linkage basis but is not a prerequisite for the current design.

## Domain Model

Persist `companyLinkageBasis` on each immutable `SourceSelectionProposalItem` with these values:

- `structural`: the candidate is linked through confirmed SEC CIK, an official company domain, the existing exact website-domain alias in the decoded URL path, or the complete normalized legal-name sequence in the decoded URL path.
- `discovery_metadata`: the candidate is hosted by a declared institutional publisher or shared IR host and its discovery title contains either the complete normalized legal-name token sequence or the exact first label of the confirmed company website domain as a token of at least five characters.
- `unverified`: the policy cannot establish either structural or allowed discovery-metadata linkage.
- `not_evaluated`: the policy deliberately does not infer company linkage, including analyst-supplied URLs and historical items that predate this field.

`companyLinkageBasis` records the basis used by the proposal policy. It is not a confidence score, publisher authority, analyst decision, or canonical company identity. Analyst acceptance never rewrites `discovery_metadata` as `structural`.

Persist two role lists with different ownership:

- `declaredCoverageRoles`: the role capabilities declared by the versioned authority and document-capability registry before candidate-specific company-linkage gating.
- `eligibleCoverageRoles`: the subset that this exact candidate may use to satisfy automatic coverage roles.

Every non-`structural` discovered candidate has `eligibleCoverageRoles: []`. A `discovery_metadata` item may retain non-empty `declaredCoverageRoles` so later consumers can inspect publisher capability without mistaking it for automatic dossier coverage.

## Classification Policy

Evaluate company linkage after authority classification and before automatic role eligibility.

1. Preserve existing structural checks for SEC, official company domains, shared IR hosts, institutional publishers, and qualified partners.
2. If structural linkage fails, consider `discovery_metadata` only when the authority tier is `institutional_independent` or `company_hosted_ir`.
3. Normalize the discovery title and company legal name into lowercase alphanumeric tokens. Remove legal suffixes from the legal name. Require the complete remaining legal-name sequence, or require the exact confirmed website-domain alias as a title token with at least five characters.
4. Reject ticker-only matches, partial tokens, substrings, query parameters, discovery categories, generic legal-name words, and aliases shorter than five characters.
5. Never use metadata attribution to override a positive structural conflict such as a mismatched SEC issuer CIK.
6. Keep `qualified_partner`, `unverified`, excluded publishers, search/index pages, Community content, and low-information documents under their existing manual-review or alternative policies.

The metadata link creates a triage contribution such as `company_linkage:discovery_metadata:<host>:<topic>`. This contribution permits deterministic proposal composition but is not a document-family contribution and cannot satisfy a coverage role. Existing duplicate rules, publisher diversity limits, family caps, recommendation ceiling, and no-new-contribution behavior remain active.

## Recommendation and Approval Semantics

`recommended` means that the system proposes including a source in the corpus. It does not mean the source has satisfied an automatic coverage obligation, its content has been read, or its claims are valid.

A `discovery_metadata` source may be recommended by default. It remains subject to the discovered-source recommendation ceiling. Its automatic roles remain empty, so all corresponding coverage gaps remain visible. During grouped approval, a pending recommended source becomes an append-only `accepted` source decision through the existing atomic operation.

After corpus approval, the source follows the normal retrieval, normalization, passage-location, claim extraction, structural validation, and analyst-review flow. No second company-linkage checkpoint is added. Precise passage provenance and approved-corpus membership remain mandatory, and metadata attribution never becomes claim evidence by itself.

Analyst-supplied sources remain recommended before and outside the discovered-source ceiling. Their `origin` records analyst authorship, while `companyLinkageBasis` remains `not_evaluated` unless a later explicit design introduces an analyst linkage decision.

## Persistence and Compatibility

The implementation uses a widen-first schema change. `companyLinkageBasis` and `declaredCoverageRoles` are initially optional. Readers use the safe historical fallbacks `not_evaluated` and `[]`; the existing `eligibleCoverageRoles` fallback remains `[]`. Historical items are never reinterpreted from the current registry.

The implementation advances the policy to `source-selection-v5` and the publisher-capability registry version when necessary. Active draft proposals produced by older policies become `outdated` and require the existing explicitly authorized rebuild flow. Rebuilds create new immutable proposal records and preserve append-only analyst decisions. Approved corpus revisions remain unchanged.

## Analyst Interface

Metadata-linked items remain in the `Recommended` view. Their card annotation states that the source was linked from discovery metadata and that its content has not been read. Authority tier and document kind remain separate labels.

Coverage gaps remain visible in the proposal summary. The detail surface may show `declaredCoverageRoles` as publisher or document capabilities and `eligibleCoverageRoles` as automatic coverage for this candidate. The copy must not imply that a declared role is already satisfied or that discovery metadata proves source content.

No new tab, blocking exception queue, or required analyst action is introduced. The existing `Adjust proposal`, `Inspect all candidates`, include, remove, reset, and grouped approval interactions remain unchanged.

## Failure Handling

- Missing title, incomplete legal-name sequence, short or partial alias, or host outside the positive registry yields `unverified` and preserves the current alternative behavior.
- A structural identity conflict yields `needs_attention`; metadata attribution cannot downgrade the conflict.
- A metadata-linked candidate that is duplicate, exceeds a cap or ceiling, or adds no distinct triage contribution remains an alternative with the applicable reason.
- Registry or policy drift makes an active draft outdated and requires rebuild.
- Retrieval or extraction failure after approval remains a structured source failure and never silently changes `companyLinkageBasis`.

## Verification Strategy

Policy tests must prove the following cases through the public policy owner:

- institutional publisher plus complete normalized legal name in an opaque-title result yields `discovery_metadata`, `recommended`, declared roles preserved, and eligible roles empty;
- shared IR host plus an exact domain alias of at least five characters in the title yields the same linkage basis without inferring document kind from the title;
- ticker only, alias shorter than five characters, partial legal name, substring, query parameter, discovery category, partner host, and unregistered publisher never yield `discovery_metadata`;
- structural linkage preserves normal eligible roles;
- structural CIK conflict remains `needs_attention`;
- analyst URLs remain `not_evaluated` and retain their current recommendation behavior;
- no non-structural candidate closes a coverage gap.

Persistence tests must cover safe historical hydration, immutable writes, proposal projection, policy-version rebuild, and preservation of append-only decisions. Component tests must verify analyst-safe copy, inclusion by default, and continued visibility of unsatisfied coverage roles.

The frozen-corpus benchmark must reclassify the targeted Q4 and Morningstar cases explicitly while preserving zero forbidden recommendations, zero duplicate recommendations, zero recommendations without contribution, and zero classification mismatches. Add a separate metadata-triage recall metric rather than counting these candidates as automatic role obligations.

## Decision

Adopt the durable `companyLinkageBasis` model, persist declared and candidate-eligible roles separately, and permit narrowly scoped `discovery_metadata` candidates from institutional publishers and shared IR hosts to be recommended by default without automatic coverage eligibility. Record the contract in ADR-022 before implementing production behavior.