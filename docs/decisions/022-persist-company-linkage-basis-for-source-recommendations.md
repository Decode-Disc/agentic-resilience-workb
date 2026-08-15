# ADR-022: Persist Company Linkage Basis for Source Recommendations

## Status

Accepted

## Date

2026-08-15

## Context

ADR-021 correctly separated publisher provenance from automatic coverage-role eligibility and prevented titles from establishing company identity, document kind, duplicate identity, or role coverage. Its structural URL-only company-linkage rule is intentionally safe but too restrictive for a narrow class of useful sources hosted by declared institutional publishers and shared investor-relations platforms.

The frozen source corpus contains two concrete examples. An opaque Q4-hosted annual report and a Morningstar analysis explicitly name ServiceNow in discovery metadata but do not expose the company in the URL path. The current policy keeps both available for manual inclusion, yet excludes them from the proposed corpus because one structural proof controls both corpus triage and automatic coverage eligibility.

Those decisions have different consequences. Recommending a source means proposing its inclusion behind the durable analyst corpus checkpoint. Filling a coverage role means asserting that the system has enough candidate-specific authority and identity evidence to hide a missing role before the analyst has read the source. A source can be useful enough for the first decision without being safe enough for the second.

The current Exa discovery contract exposes URL, title, publication date, result ID, and result position. It does not expose a structured company identifier. Any intermediate linkage state must therefore describe discovery metadata honestly rather than claiming publisher-verified or canonical company identity.

## Decision

Advance the source-selection contract to a new policy version that persists candidate-specific company-linkage basis separately from publisher authority, document kind, recommendation disposition, automatic role eligibility, and analyst decision.

Add `companyLinkageBasis` to immutable proposal items with four states:

- `structural`: linkage is established by confirmed SEC CIK, official company domain, or the existing exact domain-alias or complete legal-name sequence in the decoded URL path.
- `discovery_metadata`: structural linkage is absent, the host is a declared institutional publisher or shared IR host, and the discovery title contains either the complete normalized legal-name token sequence or the exact first label of the confirmed company website domain as a token of at least five characters.
- `unverified`: neither allowed linkage rule succeeds.
- `not_evaluated`: the policy deliberately does not infer linkage, including analyst-supplied sources and safely hydrated historical items.

Discovery metadata never creates `structural` linkage. Ticker-only matches, aliases shorter than five characters, partial tokens, substrings, query parameters, discovery categories, generic legal-name words, qualified partners, and unregistered publishers cannot create `discovery_metadata`. A positive structural conflict such as a mismatched SEC issuer CIK remains `needs_attention` and cannot be overridden by title metadata.

Persist `declaredCoverageRoles` separately from `eligibleCoverageRoles`:

- `declaredCoverageRoles` records the capabilities declared by the versioned authority and document registry before candidate-specific company-linkage gating.
- `eligibleCoverageRoles` records the roles that this exact candidate may satisfy automatically.

Only `structural` discovered candidates may retain automatic role eligibility. Every `discovery_metadata` or `unverified` discovered candidate has `eligibleCoverageRoles: []`, even when its publisher has declared capabilities. This preserves capability information without allowing an attributed source to conceal a coverage gap.

A `discovery_metadata` candidate may be `recommended` by default when it adds a distinct metadata-triage contribution and survives existing duplicate, diversity, family-cap, and recommendation-ceiling rules. The contribution permits proposal composition only; it is not a document classification, family coverage contribution, or automatic role.

Grouped corpus approval keeps its existing semantics. A pending recommended source becomes an append-only accepted source decision. The source then follows normal retrieval, normalization, passage provenance, claim validation, and analyst review without a second company-linkage checkpoint. Approval does not rewrite `companyLinkageBasis`, and discovery metadata never becomes claim evidence by itself.

Use a widen-first persistence change. Historical items read with `companyLinkageBasis: not_evaluated`, `declaredCoverageRoles: []`, and the existing safe `eligibleCoverageRoles: []` fallback. Do not reconstruct historical linkage from the current registry. Older active drafts become outdated through the policy-version change and use the existing explicit rebuild path; approved corpus revisions remain immutable.

The analyst interface keeps metadata-linked candidates in `Recommended`, labels the discovery-metadata linkage explicitly, and continues to show unsatisfied coverage roles. Declared roles may be displayed as publisher or document capabilities, but never as already satisfied dossier coverage.

## Alternatives Considered

### Add only a new reason code

- Pros: smallest schema and policy change.
- Cons: forces future UI, audit, rebuild, and extraction consumers to reinterpret a combination of authority, title, reason, and disposition; does not preserve the basis as a first-class immutable decision input.
- Rejected: changing grouped recommendation behavior makes the linkage basis durable domain knowledge rather than presentational copy.

### Require a structured provider company identifier before changing recommendations

- Pros: strongest future signal and lower title-attribution ambiguity.
- Cons: the current discovery contract exposes no such identifier; waiting leaves measured useful candidates deferred and makes the design depend on an unverified provider capability.
- Deferred: a future provider-owned identity may introduce a stronger linkage basis after its contract and behavior are verified.

### Put metadata-linked candidates in `Needs attention`

- Pros: makes uncertainty highly visible and requires a source-specific analyst action.
- Cons: recreates repetitive triage, conflicts with the selected default-inclusion behavior, and is unnecessary because automatic coverage remains empty and grouped corpus approval is already explicit.
- Rejected: metadata-linked candidates remain visible recommendations, not blocking exceptions.

### Treat analyst acceptance as structural verification

- Pros: produces a simple final state.
- Cons: destroys the distinction between system-observed linkage basis and human corpus decision, and rewrites immutable proposal history conceptually.
- Rejected: analyst authority remains in append-only source decisions.

## Consequences

- Recommendation recall improves for narrowly attributed institutional and shared-IR sources without hiding automatic coverage gaps.
- `recommended` is clarified as proposed corpus inclusion, not automatic role satisfaction or evidence validation.
- Proposal items gain two durable fields and a clearer separation between registry capability and candidate-specific automatic eligibility.
- The title becomes an allowed input only for the bounded `discovery_metadata` linkage state. It remains prohibited for structural identity, document classification, duplicate identity, automatic role eligibility, and coverage contributions.
- The policy remains deterministic and metadata-only, with no pre-approval retrieval or provider call.
- Benchmark expectations must explicitly classify metadata-triage obligations separately from automatic coverage obligations.

## Supersession

This ADR supersedes ADR-021 only where ADR-021 requires structural URL-path company linkage for every automatic recommendation and prohibits every use of titles in company-linkage triage. ADR-021 remains authoritative for publisher provenance, document classification, duplicate identity, automatic role eligibility, coverage-gap integrity, qualified-partner handling, immutable proposal history, and the prohibition on using titles as evidence or content proof.