# ADR-014: Use Reusable Access Codes for Stable Visitors

## Status

Accepted

## Date

2026-07-27

## Context

ADR-007 tied a single-use invitation to one anonymous Convex Auth user. Signing
out invalidates that anonymous session, so the same person could not sign back
in without administrator rotation. This conflicts with the workbench's visible
logout control and prevents the prototype author from switching between the
administrator and analyst sessions during development.

The prototype still has exactly five private visitor slots and no email,
password, or hosted identity provider. A reusable four-digit code is a
long-lived bearer credential with limited entropy, but the existing
identity-specific and deployment-wide attempt limits materially bound online
guessing for this narrow five-visitor prototype.

## Decision

Keep Convex Auth anonymous sessions and the five configured access slots: one
administrator and four analysts. Continue storing only HMAC-SHA-256 code
digests with a server-only pepper. Retain the four-digit format and the claim
attempt limits from ADR-013.

Treat each configured code as a reusable workspace access code:

- The first successful use creates the slot's stable `Visitor`.
- A later use by a new anonymous Auth user atomically rebinds that same
  `Visitor` to the new Auth user.
- Rebinding preserves the visitor ID, role, quota usage, dossiers, and audit
  history while removing authorization from the previous Auth identity.
- Every session rebind is audited without persisting or logging the plaintext
  code.
- Signing out remains a real Convex Auth sign-out. The visitor may sign back in
  with the same code or select another visitor by entering that visitor's code.
- Rotating a configured code revokes the currently bound session. The next use
  of the rotated code reactivates and rebinds the same stable `Visitor`.

The persistence names `Invitation` and `invitations` remain for compatibility,
but user-facing copy calls the credential an access code. ADR-014 supersedes
the single-use and lost-session recovery portions of ADR-007, the single-use
statement in ADR-012, and the single-use property retained by ADR-013.

## Consequences

- Logout followed by the same code restores the same visitor and quota state.
- Entering a different visitor's code after logout supports deliberate
  administrator and analyst session switching.
- A successful login on a new anonymous identity invalidates the previous
  identity's protected access for that visitor.
- Code rotation does not create a replacement visitor or reset analysis usage.
- Four-digit access codes are persistent bearer credentials. The deployment
  must retain server-side rate limiting, secret rotation, separate environment
  configuration, and a strict five-slot ceiling.
- This mechanism is proportionate only to the private five-visitor candidature
  prototype. Wider exposure requires a durable higher-entropy authentication
  method rather than looser rate limits.
