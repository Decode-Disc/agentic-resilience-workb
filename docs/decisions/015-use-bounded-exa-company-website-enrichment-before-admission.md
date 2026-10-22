# ADR-015: Use Bounded Exa Company Website Enrichment Before Admission

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted

## Date

2026-08-06

## Context

The public Start surface resolves a selected US-listed company through SEC
before the visitor enters a workspace access code. Company favicons make the
candidate and confirmation surfaces easier to scan, but SEC metadata does not
always include the commercial website that owns the most recognizable favicon.

ADR-012 calls this preflight non-billable. In product terms, that means it does
not reserve one of the visitor's analyses or create a research run. It does not
mean that every supporting provider call has a zero-dollar cost. The Exa API
may consume promotional, monthly, or paid credits even when the visitor has
not yet been admitted.

Website enrichment is visual metadata. It must never become company identity,
research evidence, or a prerequisite for a valid SEC preflight.

## Decision

Keep Exa website resolution available before admission only for company visual
enrichment. Preserve SEC CIK as the sole canonical identity and use this
display fallback order:

1. cached commercial website resolved for the CIK;
2. SEC investor-relations website;
3. the existing company icon.

Apply the following application-owned controls:

- consult the durable CIK cache before Exa and refresh entries after 30 days;
- retain a stale cached website when refresh fails;
- deduplicate an enrichment operation by CIK, resolver version, and cache
  window;
- check the paid-work emergency switch before constructing the Exa SDK;
- request at most five search results with contents disabled;
- attempt at most three displayed candidates plus the explicitly selected
  company per search session;
- allow at most 12 enrichment calls per anonymous session and 25 calls
  deployment-wide in a rolling 15-minute window;
- use one attempt and a five-second application timeout;
- persist latency, accepted and rejected candidate counts, and provider-reported
  search time or cost when available;
- never expose raw queries, credentials, SDK errors, or provider codes in the
  public interface.

The current Exa JavaScript SDK has no per-call `AbortSignal`, timeout, or custom
fetch injection. The application therefore treats the timeout as logical:
after timeout, cancellation, lease expiry, or execution-generation change, any
late response is ignored and cannot update company metadata or user-visible
progress.

An Exa configuration, limit, timeout, validation, or availability failure is a
typed non-blocking outcome. It never invalidates a successful SEC resolution
and never consumes an analysis reservation.

## Alternatives Considered

### Use only SEC investor-relations favicons

- Pros: no pre-admission Exa usage.
- Cons: SEC metadata often points to an investor-relations host rather than the
  commercial company site, reducing recognition in candidate lists.
- Rejected: the bounded enrichment adds visible value while the fallback still
  works when Exa is unavailable.

### Treat the Exa free tier as unmetered

- Pros: less application code.
- Cons: promotional and monthly credits can change or expire, and an accidental
  loop would remain possible.
- Rejected: free allocation does not remove the need for limits, leases,
  telemetry, or the paid-work switch.

### Move website enrichment after admission

- Pros: every Exa call would belong to an admitted visitor.
- Cons: the public candidate and confirmation surfaces would lose favicons,
  weakening the first-minute company-resolution demonstration.
- Rejected: keep the visual benefit with narrow non-blocking controls.

## Consequences

- "Non-billable preflight" continues to mean no analysis quota reservation,
  not guaranteed zero provider-credit usage.
- Exa company enrichment remains outside research evidence and cannot alter the
  selected CIK.
- Cached favicons remain visible when Exa is disabled or temporarily fails.
- Provider usage before admission is bounded, auditable, and reversible through
  the existing emergency switch.
- A wider public launch would require revisiting the anonymous-session and
  deployment-wide ceilings.
