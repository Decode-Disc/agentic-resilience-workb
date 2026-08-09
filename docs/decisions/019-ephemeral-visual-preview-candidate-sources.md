# ADR-019: Ephemeral Visual Preview of Candidate Sources Before Corpus Approval

## Status

Proposed

## Date

2026-08-09

## Context

The source checkpoint requires an analyst to approve a proposed corpus of candidates. Each candidate provides metadata — title, URL, authority tier, document kind, date, and a selection reason — but the analyst cannot see what the page looks like without opening the URL in a separate browser tab.

An embedded preview would let the analyst visually inspect a candidate before deciding to accept or reject it. However, loading a page inside the workbench introduces a material boundary question: the system forbids source content retrieval, normalization, and evidence extraction before corpus approval. A visual preview must respect that boundary without weakening it.

The handoff in `tmp/playwright-browser-preview-handoff-2026-08-05.md` captures the design intent and constraints for this feature.

## Decision

Authorize ephemeral visual rendering of a candidate public HTTPS URL as a narrow exception to the pre-approval retrieval boundary.

A preview is a **visual screenshot only**. It is not source retrieval, content normalization, structured extraction, or evidence. The preview service must never return scraped HTML, text, OCR output, or any form of machine-readable page content. A preview cannot contribute to a corpus, claim, assessment, map, or brief.

The following constraints apply:

### What a preview is

- A fixed-viewport PNG screenshot of a candidate public HTTPS URL.
- Transient — never persisted to Convex or durable storage.
- Visually distinct from accepted evidence in the UI.
- Only available for pending (undecided) candidate sources.
- A convenience that saves the analyst from opening a separate browser tab.

### What a preview is not

- Source retrieval, content normalization, or extraction.
- Evidence. It carries no claim classification, provenance, or passage locator.
- A substitute for the mandatory corpus-approval checkpoint.
- A document viewer, crawler, PDF renderer, or accessibility tool.
- Available for accepted or rejected sources.
- A guarantee that the page renders or that its content is reviewable.

### Service boundary

The preview service runs as a self-hosted Playwright container, deployed
separately from the Convex backend and the TanStack Start frontend. It exposes
a single `POST /render` endpoint that:

- accepts only public `https:` URLs validated under the DNS, redirect, and SSRF
  rules from ADR-011 and `convex/domain/publicSourceUrl.ts`;
- revalidates every redirect hop against the same rules and connects to the
  address that was validated;
- creates a fresh browser context per request with no cookies, cache, storage,
  credentials, or downloads;
- returns a single PNG screenshot at a fixed 1280×720 viewport;
- tears down the browser context in a `try/finally` regardless of outcome;
- enforces bounded timeouts, response sizes, and a strict concurrency queue;
- requires a shared-secret Bearer token on every request;
- logs minimal structured metadata only (hostname, duration, status code, error
  type) and never logs page content, full URLs, or screenshots.

### Application boundary

The frontend never communicates with the preview service directly. A new Convex
HTTP action routes requests through the authorized backend:

- authenticates the visitor via Convex Auth;
- validates that the source belongs to an active research run owned by the
  visitor;
- validates that the source decision is `pending` — previews are only for
  undecided candidates;
- rate-limits per visitor, run, and source (max one render attempt per 30
  seconds);
- proxies the render request to the preview service with the shared secret;
- returns the screenshot as a base64-encoded data URL to the frontend;
- records a lightweight preview-attempt metadata row (visitor, run, source,
  status, duration, error type) without persisting the screenshot image.

### UI contract

The `BrowserView` component gains three new states — loading, screenshot
available, and unavailable — alongside its existing external-link fallback.
When a screenshot is displayed:

- it carries a visible `Preview — for visual reference only` label;
- it uses distinct visual treatment that does not reuse evidence classification
  tokens;
- it appears inside the Preview tab of the source context panel, never inside
  the evidence matrix or assessment surfaces;
- a rendering failure or timeout falls back cleanly to the existing `Open
  original` external link.

### Non-weakening clause

None of the following are weakened, reinterpreted, or bypassed by this
decision:

- the mandatory corpus-approval checkpoint before retrieval and extraction;
- the rule that rejected sources cannot contribute to passages, claims,
  assessments, maps, or briefs;
- the SSRF, DNS, redirect, and URL validation contract from ADR-011;
- the product invariant that UI progress comes only from persisted workflow
  events.

## Alternatives Considered

### Direct iframe embedding

- Pros: simplest implementation, no additional infrastructure.
- Cons: external publishers block embedding through `X-Frame-Options` and CSP
  `frame-ancestors`. An `<iframe>` would render a blank frame for many sources.
- Rejected: the handoff explicitly requires a reliable rendering approach that
  does not depend on publisher cooperation.

### Third-party managed browser service (Browserless, Browserbase)

- Pros: no self-hosted infrastructure, faster initial implementation.
- Cons: operational cost at scale, additional service dependency, data flows
  through a third party.
- Rejected: the handoff explicitly prefers a self-hosted Playwright service.

### Retrieve page content as HTML and render it server-side

- Pros: avoids running a full browser.
- Cons: blurs the boundary between visual preview and content retrieval.
  Rendering HTML faithfully requires interpreting CSS, JavaScript, and
  third-party resources — effectively reimplementing a browser.
- Rejected: a Playwright screenshot preserves the boundary more cleanly.

### Skip previews and keep external links only

- Pros: no boundary decision needed, zero additional infrastructure.
- Cons: the analyst must open every candidate URL in a separate tab, which
  slows the review workflow.
- Rejected: a narrow, well-bounded preview reduces friction without weakening
  the core evidence invariants.

## Consequences

- The prototype gains a visual preview capability that reduces context-switching
  during source review.
- A new Playwright Docker container adds an operational dependency, deployment
  surface, and maintenance cost.
- The Convex HTTP action boundary adds a new authenticated route and rate-limit
  configuration.
- Previews are explicitly non-evidence. If a future feature requires
  screenshot persistence (e.g., a visual archive of approved sources), a
  separate ADR must authorize storage, retention, and provenance rules.
- If the preview service is unreachable, the UI degrades to the existing
  external-link fallback without blocking source review or corpus approval.
