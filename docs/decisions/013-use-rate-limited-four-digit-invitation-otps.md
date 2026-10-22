# ADR-013: Use Rate-Limited Four-Digit Invitation OTPs

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted in part. The four-digit format and rate limits remain; ADR-014
supersedes the single-use property.

## Date

2026-07-27

## Context

ADR-007 originally specified high-entropy invitation secrets. That format is
awkward to read, remember, and enter during the prototype's invitation handoff.
A four-digit code has only 10,000 combinations, so changing the presentation
without changing server enforcement would make online guessing unacceptably
easy.

## Decision

Represent each invitation and administrator recovery code as exactly four
decimal digits and collect it with the shared OTP input. Keep the ADR-007
properties that make each invitation single-use, server-digested with
HMAC-SHA-256 and a server-only pepper, and atomically linked to one anonymous
Convex Auth identity.

Before digest verification, atomically consume an attempt from both limits:

- five attempts per anonymous Auth identity in a fixed 15-minute window;
- 25 attempts across the deployment in the same window.

Malformed values outside the four-digit contract are rejected before consuming
an attempt. Configuration may rotate the digest attached to an existing stable
slot without recreating or reactivating that slot, and every such rotation is
audited.

## Consequences

- The invitation handoff is short enough to communicate and enter manually.
- The lower entropy is explicit and depends on server-side online-attempt
  limits; the UI is not a security boundary.
- Creating another anonymous identity does not bypass the deployment-wide
  ceiling.
- A burst of invalid claims can temporarily block legitimate admissions for up
  to 15 minutes. This is acceptable for the five-visitor prototype but would
  need a stronger identity or delivery mechanism before wider exposure.
- Plaintext OTPs and the pepper remain outside persisted application data,
  logs, source control, and client configuration.
