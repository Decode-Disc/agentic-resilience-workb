# ADR-019: Ephemeral Visual Preview of Candidate Sources Before Corpus Approval

## Status

Accepted

## Date

2026-08-09; amended 2026-08-14 to authorize a short-TTL preview cache

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
- Transient — cached for a short TTL (see "Preview caching" below), never
  persisted as evidence or a durable document record.
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

The frontend never communicates with the preview service directly. A Convex
action routes requests through the authorized backend:

- authenticates the visitor via Convex Auth;
- validates that the source belongs to an active research run owned by the
  visitor;
- validates that the source decision is `pending` — previews are only for
  undecided candidates;
- returns a cached screenshot when a fresh entry exists, without touching the
  preview service;
- rate-limits only the render path (max two render attempts per visitor, run,
  and source in a 30-second window);
- proxies the render request to the preview service with the shared secret;
- returns the screenshot as a base64-encoded data URL to the frontend;
- stores the rendered screenshot in a short-TTL cache (see below), never as
  evidence.

### Preview caching

Rendering a screenshot launches Chromium, which is the expensive operation.
To avoid re-rendering on every view and preserve the preview service, the
rendered screenshot is cached for a bounded time:

- A `previewCaches` record is keyed by `sourceId` (stable, unique per
  candidate).
- The entry holds only the rendered data URL, its byte size, and an
  `expiresAt` timestamp derived from a server-configured TTL
  (`PREVIEW_CACHE_TTL_MS`, default one hour). Entries past `expiresAt` are
  treated as absent.
- A size cap bounds each entry (over-sized screenshots are returned but not
  cached), preventing unbounded storage growth.
- The cache is read through a reactive Convex query, so a repeat view within a
  session returns the screenshot immediately without re-rendering, and a cache
  hit never reaches the preview service.
- When a source's decision becomes `accepted` or `rejected`, its cache entry is
  purged. The approval checkpoint and the "rejected sources cannot contribute
  downstream" rule remain unchanged.

The cached screenshot remains distinct from evidence: it has no claim
classification, provenance, or passage locator, and it is never read by
extraction, assessment, map, or brief surfaces.

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
- The Convex action boundary adds an authenticated render path and rate-limit
  configuration.
- A short-TTL `previewCaches` table stores bounded screenshot data URLs keyed
  by source, purged on decision and on TTL expiry. This cache is a rendering
  optimization, not evidence storage.
- Previews are explicitly non-evidence. If a future feature requires
  screenshot persistence (e.g., a visual archive of approved sources), a
  separate ADR must authorize storage, retention, and provenance rules.
- If the preview service is unreachable, the UI degrades to the existing
  external-link fallback without blocking source review or corpus approval.
