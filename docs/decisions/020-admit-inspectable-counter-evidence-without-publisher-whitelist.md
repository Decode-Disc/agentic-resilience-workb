# ADR-020: Admit Inspectable Counter-Evidence Without a Publisher Whitelist

## Status

Superseded by ADR-021

## Date

2026-08-15

## Context

ADR-018 introduced `source-selection-v2`, a deterministic policy that classifies authority and document kind independently from discovery intent. That policy gates the `counter_evidence` and `independent_analysis` source families behind a fixed publisher whitelist (`INSTITUTIONAL_HOSTS`): Reuters, Bloomberg, FT, WSJ, Morningstar, Gartner, Forrester, IDC, FTC.gov, and justice.gov.

The ServiceNow run `k979t5nzs6bmkxbp7eref2bkzx8bag4f` exposed a structural consequence of that gate. The `balanced` coverage preset requires `counter_evidence_primary` and `counter_evidence_secondary` through `REQUIRED_BALANCED_ROLES`, but the role-matching logic can only satisfy those roles with candidates whose `sourceFamily` is `counter_evidence` or `independent_analysis`. Both families are produced only by the `institutional_independent` authority branch of `classifyDocument`. `authorityTier` assigns that branch only to the ten whitelisted hosts. The discovery `category` field — which records that a candidate was deliberately retrieved as `counter_evidence` — is never read by `classifyCandidate`, `classifyDocument`, `familyFor`, `authorityTier`, or `contributionsFor`.

In this run, seven candidates discovered under `category: "counter_evidence"` carried genuine independent or bear-thesis value but resolved to `authority = unverified`, `documentKind = unknown`, `sourceFamily = unrecognized`, and `coverageContributions = []`, then fell to `alternative` with reason `unverified_publisher`:

- `intellectia.ai` — "UBS Downgrades ServiceNow to Neutral Amid AI Disruption Risks" (an institutional signal carried by a non-whitelisted aggregator)
- `hatedmoats.substack.com` — "ServiceNow: Deep Dive Analysis"
- `capitalblueprint.substack.com` — "ServiceNow Inc. (NYSE: NOW) — Deep Analysis Report"
- `earningsmoat.com` — "SERVICENOW, INC. NOW 2025 10-K Analysis"
- `marginofinsight.com`, `flash.stocksentinel.ai`, `secure.fundsupermart.com` — independent equity research

An eighth candidate, a genuine `official_commercial_terms` document (`static.carahsoft.com/.../ServiceNow_EULA.PDF`), was dropped for the same reason because `carahsoft.com` is absent from `PARTNER_HOSTS`, even though Carahsoft is a first-tier public-sector IT distributor of ServiceNow terms.

The result is a self-inflicted coverage gap: the `balanced` preset demands counter-evidence, but the whitelist makes it effectively unfillable from open-web discovery. This is in tension with product invariant 3, which requires counter-evidence and critical unknowns to be visible before dimension review. The policy is correctly strict on low-information SEC filings, community content, indexes, and duplicates; the defect is confined to the counter-evidence and qualified-reseller dimensions.

## Decision

Preserve ADR-018's authority classification for primary, regulator, and company-hosted sources unchanged. Relax the counter-evidence dimension so that a candidate's discovery intent is no longer erased and genuinely useful independent sources remain inspectable rather than dropped to `unrecognized`.

1. **Propagate discovery intent.** Read the persisted `category` field during classification. A candidate discovered under `counter_evidence` retains a `counter_evidence_publisher:<host>` contribution even when its publisher is not whitelisted, so the source is classified into the `counter_evidence` family rather than `unrecognized`.

2. **Admit a low-authority counter-evidence tier.** Do not promote unverified publishers to `institutional_independent`. Instead, classify non-whitelisted independent or bear-thesis candidates as `counter_evidence` family at `unverified` authority, eligible to satisfy `counter_evidence_primary` and `counter_evidence_secondary` under the existing per-host diversity and family caps. They remain explicitly low-authority and are never treated as primary or regulator evidence.

3. **Keep the durable human checkpoint as the integrity boundary.** These sources stay visible in the proposal, tagged with their authority tier, and require explicit analyst approval to enter the corpus. The relaxation widens what the analyst can see and decide; it does not weaken rejected-source exclusion, append-only decisions, or the pre-approval no-retrieval boundary.

4. **Recognize qualified resellers.** Add `carahsoft.com` to the qualified-partner registry, or introduce a `qualified_reseller` authority tier, so authentic commercial-terms documents distributed by first-tier public-sector resellers classify as `official_commercial_terms` instead of `unverified_publisher`.

Registry changes continue to require a fixture, a role justification, and a registry-version bump, consistent with ADR-018.

## Alternatives Considered

### Add the specific counter-evidence hosts to the whitelist

- Pros: minimal code change; each discovered source becomes `institutional_independent`.
- Cons: special-cases the symptom instead of the cause, does not scale to the long tail of independent publishers, and silently elevates unvetted blogs to institutional authority.
- Rejected: authority inflation contradicts ADR-018's tiered-authority intent.

### Use a model call to judge independent-source quality

- Pros: materially better relevance and authority judgment than metadata alone.
- Cons: adds provider cost, availability, telemetry, and retry requirements, and conflicts with the no-pre-approval-retrieval boundary.
- Rejected for now: reconsider only through a later decision supported by measured need, per ADR-017 and ADR-018.

### Keep the whitelist and record the gap as acceptable

- Pros: no change; maximum conservatism on authority.
- Cons: leaves `counter_evidence_primary` and `counter_evidence_secondary` structurally unfillable from open-web discovery and violates the evidence-matrix symmetry required by product invariant 3.
- Rejected: the gap is a policy defect, not a deliberate trade-off.

## Consequences

- Counter-evidence discovered from the open web can now reach the analyst as inspectable, low-authority candidates instead of being silently dropped.
- The `counter_evidence_primary` and `counter_evidence_secondary` coverage roles become fillable under the `balanced` preset without authority inflation.
- Authority tiers remain meaningful: primary, regulator, company, and institutional sources keep their high-trust tier; unverified independent sources are visible but clearly low-authority.
- The policy remains metadata-only and deterministic, with no additional model call or pre-approval content retrieval.
- The change requires fixtures for the new classification paths and a `SOURCE_SELECTION_POLICY_VERSION` or registry-version bump so existing proposals become `outdated` and require an explicit rebuild, preserving immutable proposal history.

## Supersession

This ADR refines ADR-018's authority and document-kind classification for the counter-evidence and qualified-partner dimensions only. ADR-018 remains authoritative for duplicate removal, role coverage, caps, the recommendation ceiling, `needs_attention` semantics, the rebuild lease, and the human checkpoint.
