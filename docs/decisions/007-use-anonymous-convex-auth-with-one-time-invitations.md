# ADR-007: Use Anonymous Convex Auth with One-Time Invitations

## Status

Accepted

## Date

2026-07-22

## Context

The candidature prototype needs persistent private access for exactly five visitors without adding an email or hosted identity provider. A reusable invitation code would become a long-lived bearer credential with weak recovery and revocation semantics.

## Decision

Use Convex Auth with its anonymous provider for session management. Create exactly five stable invitation slots through server configuration: one administrator and four analysts.

Each invitation code is a high-entropy, single-use secret. Persist only an HMAC-SHA-256 digest using a server-only pepper. Claiming a code atomically links the authenticated Convex Auth user to one `Visitor` and marks the invitation claimed. A later session for the same Auth user resolves the same visitor; another user cannot reuse the code.

The administrator may restore an unused analysis reservation only with a persisted reason. A lost administrator session is recovered through an internal, environment-configured rotation operation that revokes the previous visitor before reissuing the same invitation slot.

## Consequences

- Invitation codes, peppers, and Auth signing keys remain outside source control and persisted application data.
- Clearing the anonymous Auth session requires an administrator to rotate the affected invitation.
- Rotation preserves the five-slot limit and invalidates authorization for the old session.
- Development and production deployments require separate Auth keys, peppers, and invitation codes.
- The prototype avoids email delivery and a third-party identity service while retaining server-side authorization.
