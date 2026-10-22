# ADR-017: Use Deterministic Source Selection Proposals

## Status

Accepted; source-ranking and fixed-target sections superseded by ADR-018; analyst-source ceiling rule superseded by ADR-021. [ADR-024](024-qualify-source-content-before-corpus-approval.md) supersedes the metadata-only preparation and no-pre-approval-reading assumptions. Proposal composition remains deterministic, while bounded qualification and comparison may call models before composition. The rejected pre-approval-reading alternative below records the earlier rationale, not a current prohibition.

## Date

2026-08-07

## Context

The mandatory source checkpoint protects evidence integrity, but the current interaction requires the analyst to accept, reject, or leave pending every candidate source individually. A dossier may contain up to 48 candidates, so this interaction transfers discovery triage back to the analyst instead of accelerating preparation work.

ADR-008 already permits approval of a corpus revision while some candidates remain pending and requires individual append-only decisions behind grouped review actions. The human checkpoint therefore does not require one human interaction per source. It requires an explicit analyst approval of the corpus that will be allowed to contribute downstream.

The prototype also needs to limit later retrieval and extraction costs. A model-based pre-approval reading stage would improve selection precision, but it would add inference and retrieval cost and conflict with the current rule that source content is not retrieved before corpus approval.

## Decision

Create one immutable, versioned `SourceSelectionProposal` for the active draft `CorpusRevision`, with immutable `SourceSelectionProposalItem` records for its candidate classifications. The proposal stores its policy version, recommendation ceiling, candidate-input fingerprint, status, creation time, and per-source disposition, rank, and reason codes. The active ceiling contract is defined by ADR-018.

Build the proposal without an additional model call. Use only validated discovery metadata, source origin, source category, provider result position, publication date, canonical identity, and analyst-supplied origin. The proposal is a relevance estimate and corpus-composition aid, never a truth score or evidence decision.

Apply the deterministic policy in three passes:

1. Remove exact canonical duplicates from consideration, identify manifestly superseded versions where metadata proves the relationship, and classify candidates without sufficient metadata as alternatives or items needing attention.
2. Recommend the best eligible candidate from each available source family required by the selected coverage preset, including regulatory coverage and counter-evidence. Missing or weak families remain visible gaps; the policy never recommends a weak source merely to fill a category.
3. Historical rule, superseded by ADR-018: fill the remaining places up to a fixed recommendation target using source-policy priority, provider result position, recency, publisher diversity, coverage preset, and research angle. The active policy instead adds only candidates with a reliable novel contribution and stops when none remains or the adaptive recommendation ceiling is reached.

Historical rule, superseded by ADR-018: set the server-owned `SOURCE_RECOMMENDED_TARGET` to 12 by default. The active policy uses `SOURCE_RECOMMENDATION_CEILING`, which defaults to `ceil(SOURCE_CANDIDATE_LIMIT / 2)` and is a ceiling, never a fill target. The analyst may explicitly include more sources.

Classify each proposal item as `recommended`, `needs_attention`, or `alternative`. `needs_attention` is non-blocking. Approval is blocked only when there is no source to accept, the proposal is stale, or an integrity or authorization check fails.

Treat every valid analyst-supplied public HTTPS source as `recommended` by default. Under the active ADR-021 rule, analyst-supplied sources are outside the discovery recommendation ceiling. Display `Added by analyst` as its selection reason. The analyst may still remove it before approval.

Keep the recommendation separate from human authority. Proposal creation writes no accepted or rejected `SourceDecision`. Before approval, analyst adjustments use the existing append-only decisions: including an item writes `accepted`, removing one writes `rejected`, and undoing an adjustment writes a superseding `pending` decision.

Make `Approve proposed corpus` one atomic, idempotent server operation. It verifies the active run, execution generation, draft corpus revision, proposal version, and candidate-input fingerprint; preserves explicit analyst overrides; writes an individual accepted `SourceDecision` for every still-pending recommended source; leaves `needs_attention` and `alternative` items pending; approves the corpus revision; persists the checkpoint decision and audit event; and resumes the workflow. A new candidate makes the proposal stale and requires deterministic recomputation without overwriting analyst decisions.

Use a summary-first source-checkpoint interface. The `DiscreteTabs` labels remain `Recommended`, `Needs attention`, and `Alternatives`, but membership follows the current source selection: included sources appear under `Recommended`, undecided excluded sources originally flagged for attention remain under `Needs attention`, and other excluded sources appear under `Alternatives`. Preserve the original immutable recommendation and reasons separately from this view, mark analyst overrides, and retain review warnings on manually included items. Each overview card provides a direct include or removal action with undo. Use the existing bounded `Included` and `Available` query to keep overview membership and counts consistent with adjustment decisions, retaining incremental display. `Add source link` exposes the same public-HTTPS intake dialog on the overview and in inspection before approval. `Adjust proposal` retains its separate `Included` and `Available` working sets. `Inspect all candidates` preserves master-detail inspection, server cursor pagination, source preview, responsive drawer, and manual URL intake. Keep the shared source-card action implementation and `SourceMasterList` reusable, while Convex queries, checkpoint policy, and proposal orchestration remain in their existing owners. Approved revisions remain read-only. Secondary filters may use `AnimatedListFilter` only after its keyboard, focus, popup semantics, reduced-motion behavior, English copy, and tests meet the project accessibility contract.

This decision refines ADR-008 and ADR-016 without superseding either one.

## Alternatives Considered

### Keep individual source decisions as the default workflow

- Pros: direct control over every candidate and no new proposal records.
- Cons: requires repetitive clerical work, scales poorly to the configured candidate limit, and contradicts the product goal of accelerating analyst preparation.
- Rejected: individual inspection remains available, but it is no longer the default path.

### Use one model call to rank all source metadata

- Pros: potentially better handling of ambiguous titles and research angles.
- Cons: adds provider cost, availability, telemetry, retry, and validation requirements while still lacking source content.
- Rejected for the prototype: deterministic metadata policy is cheaper, reproducible, and sufficient for a proposal whose limitations remain visible.

### Retrieve source excerpts before approval

- Pros: materially stronger relevance and duplication judgments.
- Cons: violates the current pre-approval retrieval boundary, expands SSRF and content-processing exposure, and adds retrieval and inference cost before the analyst authorizes the corpus.
- Rejected: reconsider only through a later explicit decision supported by measured need.

### Use fixed per-category quotas or a global top twelve

- Pros: simple implementation and predictable count.
- Cons: fixed quotas can force weak sources, while a global ranking can be dominated by one source family and suppress counter-evidence.
- Rejected: dynamic minimum coverage followed by ranked filling preserves diversity without fabricating quality.

## Consequences

- The analyst approves a system-prepared corpus in one action and spends attention on exceptions or deliberate adjustments.
- The durable human checkpoint, append-only source decisions, rejected-source exclusion, and immutable corpus revisions remain unchanged.
- The proposal is reproducible and incurs no new model call, but metadata-only classification is less precise than content-aware review and must be presented as an estimate.
- The implementation adds versioned proposal persistence, indexed proposal-item reads, stale-proposal detection, and an atomic grouped-approval mutation.
- Manual source intake remains centralized through ADR-016 and joins the normal proposal and approval flow.
- The optional `source-relevance` model capability remains deferred until measured metadata-policy failures justify its cost.
- The source-review UI becomes summary-first while preserving the established master-detail inspection surface and responsive behavior.
