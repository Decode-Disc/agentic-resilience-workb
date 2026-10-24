# ADR-012: Expose Company Preflight Before Invitation Admission

## Status

Accepted; access-code terminology and reuse are amended by ADR-014

## Date

2026-07-27

## Context

The candidature needs to demonstrate real company resolution in its first
minute, while dossier creation, quota consumption, persisted research, and
operations remain limited to the five invited visitors defined by ADR-007.
Requiring an invitation before the analyst can inspect the Start surface hides
that demonstration and makes it difficult to verify the live SEC boundary.

Company preflight is non-billable, short-lived, rate-limited, and creates no
research run. It still needs a stable server identity so a confirmed preflight
cannot be consumed by another browser session.

## Decision

Make `/workspace/start` and company preflight available without invitation
admission. On entry, the client establishes a Convex Auth anonymous session.
Preflight records are owned by that Auth user, expire after 15 minutes, and do
not reserve analysis quota or start a workflow.

Request the one-time invitation in a top drawer only when the user confirms a
resolved company. After the invitation is claimed, the same Auth identity and
its preflight are adopted by the admitted `Visitor`; launch then performs the
existing atomic quota reservation and authoritative company revalidation.

Keep `/workspace/$runId` and `/workspace/admin` behind a pathless TanStack Router
layout. A direct visit with no active `Visitor` withholds the protected child
route and presents the same invitation drawer. Convex authorization remains the
security authority for every protected server operation.

## Consequences

- The public entry surface can demonstrate genuine SEC resolution before asking
  for access.
- Public does not mean identity-free: preflight requires an anonymous Convex
  Auth session and remains bound to that session.
- Invitation codes still admit at most five visitors and remain single-use.
- Quota reservation, workflow creation, dossiers, and operations remain private.
- Clearing the anonymous browser session invalidates access to any unconsumed
  preflight owned by that session.
- SEC rate limiting, validation, expiration, and provider-call telemetry apply
  equally before and after invitation admission.
