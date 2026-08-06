# ADR-016: Centralize Manual Source Intake With Expiring Preparations

## Status

Accepted

## Date

2026-08-06

## Context

Manual public URLs currently enter the product through two different paths.
The Start composer stores unverified strings in React state and defers URL
inspection until dossier launch, while an active dossier inspects and persists
a candidate immediately. The two paths duplicate retry and persistence logic,
and the UI cannot distinguish validation, transport, capacity, authorization,
or lifecycle failures reliably.

The product must continue to allow references before company selection, keep
Convex as the state owner, preserve the mandatory corpus checkpoint, and avoid
retrieving or storing source content before analyst approval.

## Decision

Use one public Convex action for every analyst-added URL:

```text
api.sourceActions.submitManualUrl({ requestKey, url, target })
```

The target is either a pre-launch collection or an active run and corpus
revision. The action authorizes the target, applies global and per-identity
limits before network access, validates and canonicalizes the public HTTPS
destination and every redirect, performs bounded metadata inspection, owns the
retry policy, and returns a typed result.

A pre-launch result creates an expiring, server-owned preparation receipt. The
receipt stores canonical metadata and ownership but is not a `Source`, corpus
member, evidence record, or workflow state. Dossier launch accepts receipt IDs
and consumes all valid receipts atomically while creating the first draft
corpus revision. Missing, expired, foreign, or invalid receipts prevent run
creation and quota consumption.

An active-run result uses the same action and the same pending-source
persistence helper, creating the `Source`, append-only pending
`SourceDecision`, `sourceReviewItems` projection, and audit event in one
transaction after revalidating the execution generation and corpus state.

Expected failures use a closed application code union carried in
`ConvexError.data`. Analyst-facing surfaces translate only that data into a
label and next action. They never render raw exceptions, provider details,
network addresses, HTTP codes, environment names, or workflow enum values.

Retry timeout, connection, upstream rate-limit, and upstream unavailable
failures once, for at most two attempts total. Do not retry deterministic URL
validation, authorization, duplicate, capacity, unsupported-content, or other
client-response failures.

## Alternatives Considered

### Continue validating raw URLs during launch

- Pros: no new receipt table.
- Cons: the composer continues to claim local success before server validation;
  launch performs avoidable network work after quota-sensitive decisions; raw
  client metadata remains the handoff.
- Rejected.

### Persist pre-launch URLs directly as sources

- Pros: no receipt-to-source conversion.
- Cons: a source cannot exist honestly without a research run and corpus
  revision; this would create a competing draft authority and weaken atomic
  launch behavior.
- Rejected.

### Expose separate pre-launch and active-run public actions

- Pros: simpler individual argument shapes.
- Cons: duplicates policy, retry, telemetry, and error contracts and recreates
  the inconsistency this decision removes.
- Rejected.

## Consequences

- “Source added” means the server has authorized and verified the URL.
- Start can prepare references before company selection without treating them
  as evidence or corpus candidates.
- Launch accepts only server-owned preparation IDs and remains all-or-nothing.
- Active dossier additions and launch-time additions share one persistence
  owner and one error taxonomy.
- Unconsumed preparations expire and do not become durable research drafts.
- Restoring a composer draft after a browser reload remains outside the MVP.