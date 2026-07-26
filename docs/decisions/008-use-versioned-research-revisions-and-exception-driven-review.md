# ADR-008: Use Versioned Research Revisions and Exception-Driven Review

## Status

Accepted

## Date

2026-07-27

## Context

The evidence workbench must preserve every material analyst decision without
turning provenance and audit requirements into repetitive clerical work.

The baseline design already requires a durable source checkpoint, append-only
analyst decisions, approved-claims-only briefs, and claim-backed map
relationships. The Phase 4–8 design refinement adds three practical needs:

- an analyst may approve a corpus while leaving some candidate sources pending;
- a later source addition must not mutate the corpus that produced an existing
  assessment;
- claim and assessment review must focus analyst attention on exceptions rather
  than require a separate interaction for every generated field.

The same atomic claim may inform several assessment dimensions. Treating each
dimension occurrence as a separate claim would create conflicting decisions and
duplicate provenance.

## Decision

Use explicit, append-only revisions and decisions.

### Corpus revisions

- Persist a `CorpusRevision` for every proposed corpus.
- Persist an individual source decision as `accepted`, `rejected`, or `pending`.
- An approved corpus revision contains only its accepted sources. Pending and
  rejected sources cannot contribute to passages, claims, assessments, maps, or
  briefs.
- An analyst may approve a revision with pending sources after the interface
  displays accepted, rejected, and pending counts and the exclusion
  consequences.
- Accepting a pending source later creates `CorpusRevision N+1` and reopens the
  durable source checkpoint. It never mutates revision N.
- External counter-evidence leads follow the same rule: they remain visible but
  cannot be retrieved or used until an analyst explicitly creates and approves
  a new corpus revision.

### Claim and dimension decisions

- Persist one canonical atomic `Claim` and reference it from any number of
  dimensions.
- Persist the analyst's claim decision separately from dimension-link
  decisions. A claim may be valid while a proposed dimension link is wrong.
- A corrected claim is a new claim that supersedes the original and retains the
  original proposal, provenance, diff, and analyst rationale.
- The UI may approve a reviewed group in one action, but the server writes an
  individual append-only decision for every affected claim and dimension link.
- A dimension becomes reviewable when all claims and links that feed its
  proposal have a decision. Other dimensions may remain locked.

### Exception-driven review

The application presents complete typed proposal packages and deterministic
policy results. Claims that pass the policy remain inspectable and may be
approved as a group. Items requiring review are surfaced as exceptions.

For a correction or missing assertion, the analyst supplies a short instruction
or inline edit. A bounded AI task proposes a complete replacement package from
the approved corpus: atomic statement, classification, passage references, and
dimension links. The analyst reviews the diff and confirms or rejects it. If the
approved corpus cannot support the requested assertion, the system preserves it
as a gap, `Hypothesis`, or `Unknown`; it never invents a citation.

### Assessment and derived-view revisions

- Each dimension decision is one atomic append-only snapshot containing
  position, confidence, three-year direction, and any justified override.
- The architecture map and brief are progressive working views. Each approved
  dimension updates only the affected sections and relationships.
- Progressive views use analyst-approved claims only, display incomplete
  coverage explicitly, and become final only after all ten dimension decisions.

## Alternatives Considered

### Require a decision for every source before corpus approval

- Pros: no unresolved candidate state.
- Cons: creates unnecessary review work and delays extraction when the accepted
  subset is already sufficient.
- Rejected: pending is an explicit, visible exclusion state.

### Mutate the current corpus when a source is added

- Pros: simpler current-state queries.
- Cons: destroys reproducibility for passages, claims, assessments, and derived
  outputs.
- Rejected: later additions create a new revision.

### Require manual structured claim authoring

- Pros: maximum direct analyst control.
- Cons: transfers extraction, classification, citation, and linking work back to
  the analyst.
- Rejected: use AI-assisted correction with deterministic validation and a
  final human decision.

### Regenerate whole derived views after every decision

- Pros: simple generation prompt.
- Cons: expensive, unstable, and difficult to audit.
- Rejected: update only the affected sections and relationships.

## Consequences

- Corpus, claim, dimension-link, assessment, map, and brief queries must be
  revision-aware.
- Group approval remains convenient without weakening append-only auditability.
- Retry and idempotency keys include the run, workflow version, corpus revision,
  step, and attempt.
- A later corpus revision may invalidate or supersede downstream proposals, but
  it cannot erase earlier analyst decisions.
- The UI must distinguish current, superseded, pending, incomplete, and final
  states without relying on color alone.
