# Centralized Manual Source Intake Implementation Plan

> **For agentic workers:** Implement this plan task-by-task with strict RED -> GREEN -> REFACTOR cycles and reviewer checkpoints between tasks.

**Goal:** Make every analyst-added public URL pass through one authoritative Convex intake workflow that validates immediately, persists atomically, and returns safe actionable errors.

**Architecture:** A single public `api.sourceActions.submitManualUrl` action authorizes and inspects URLs for either a pre-launch preparation or an active corpus revision. Pre-launch results are short-lived server-owned receipts consumed atomically by dossier launch; active-run results use the same pending-source persistence owner immediately.

**Tech Stack:** React 19, TanStack Start, Convex 1.42.1, Convex Auth, TypeScript 6, Vitest 4, pnpm 10.

## Global Constraints

- Preserve the public-HTTPS-only contract from ADR-011 and the mandatory source-review checkpoint.
- Preserve the existing Start composer, Add Source dialog, Source Review layout, navigation, responsive behavior, keyboard behavior, focus management, loading states, and motion language.
- Authorize and apply rate limits before DNS, HTTP, or provider work.
- Validate every redirect and connect to the validated public address while preserving Host and TLS SNI.
- Do not retrieve or persist source content before corpus approval.
- Do not expose raw Convex errors, HTTP codes, IP addresses, provider details, environment names, or lifecycle enums in analyst-facing copy.
- Use one failing test followed by the smallest passing implementation for each behavior.

## Plan Status

- Status: implementation complete; deterministic certification passed.
- Revision date: 2026-08-06.
- Starting repository state: clean worktree with no diagnostics in the affected source-intake files.
- Baseline evidence: `docs/verification/2026-08-06-phase-4-closure.md` records a passing `pnpm check` with 283 tests and protected browser verification.
- Final evidence: `docs/verification/2026-08-06-centralized-manual-source-intake.md` records 67 passing files / 327 passing tests, Convex and production-build certification, desktop/mobile browser checks, and the explicitly unclaimed live gates.

### Completion checklist

- [x] Task 1: typed intake contract and ADR.
- [x] Task 2: bounded metadata inspection, PDF headers, retry, and telemetry.
- [x] Task 3: expiring preparations, one public action, and centralized persistence.
- [x] Task 4: composer, dialog, protected dossier, and safe copy migration.
- [x] Task 5: automated gates, runtime legacy search, diagnostics, and available browser checks.
- [ ] Approved live public-URL preparation and launch conversion. Blocked pending explicit approval for the bounded external request.
- [ ] Protected add-and-reload through a paused review dossier. Blocked because all available analyst dossiers are already `corpus_approved`; no mutable state was manufactured.

## Authoritative Requirements And Accepted Decisions

- Analyst URLs remain proposed `analyst_url` / `analyst_supplied` candidates and never become evidence before approval.
- Anonymous Convex Auth users may prepare references before access-code admission, with global and per-session limits before I/O.
- Composer references are validated immediately and become `Source` records only during atomic dossier creation.
- Dossier launch accepts preparation IDs, never raw URLs or client-supplied canonical metadata.
- Launch is all-or-nothing for attached preparations. Missing, expired, unauthorized, or invalid preparations create no run and consume no quota.
- Expected failures distinguish category and recovery action.
- Retry only timeout, connection, upstream `429`, and upstream `5xx` failures, with at most two total attempts.
- Do not retry deterministic validation, private destinations, authorization failures, duplicates, capacity failures, unsupported content, or other `4xx` responses.

## Non-Goals

- No local file upload, pasted text, private document ingestion, or new retrieval provider.
- No redesign of the existing composer, dialog, review toolbar, master/detail layout, navigation, or motion.
- No retrieval or extraction before corpus approval.
- No generic application-wide error framework.
- No transactional dollar accounting or paid-provider workflow.

## Current-State Evidence

| Surface or contract           | Current owner                                                 | Direction  | Evidence                                                                                         |
| ----------------------------- | ------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| Start reference entry         | `src/components/workspace/research-composer.tsx`              | Modify     | Local `manualSourceUrls` currently stages unverified strings.                                    |
| Add Source dialog             | `src/components/workspace/add-source-dialog.tsx`              | Modify     | Supports either active-run `onAdd` or local `urls` state and collapses failures to generic copy. |
| Active dossier addition       | `src/components/workspace/run-route-component.tsx`            | Modify     | Calls `api.sourceActions.addManualUrl`.                                                          |
| URL inspection                | `convex/domain/publicSourceUrl.ts`, `convex/sourceActions.ts` | Modify     | Existing SSRF controls are authoritative; retry shells do not perform a second fresh attempt.    |
| Launch preparation            | `convex/researchLaunch.ts`                                    | Replace    | Accepts raw `manualSourceUrls` and inspects during launch.                                       |
| Pending candidate persistence | `convex/researchLaunch.ts`, `convex/sources.ts`               | Centralize | Source, decision, review projection, and audit insertion are duplicated.                         |
| Error translation             | `src/lib/presentation/research-copy.ts`                       | Replace    | Current logic relies on message substrings.                                                      |

## Preservation Contract

- Keep the Attach references toolbar button, count badge, pre-company-selection entry, company search, confirmation view, access-code drawer, responsive layout, and motion.
- Keep the Add Source modal structure, public-link form, disabled file controls and tooltip, inline field feedback, loading control, focus trap, and removable reference list.
- Keep the existing evidence-sufficiency and source-review entry points and reactive review projection.
- Keep HTTPS-only parsing, DNS/private-address rejection, redirect validation, pinned connection, Host/SNI behavior, ten-second timeout, bounded HTML inspection, and no pre-approval content persistence.
- Expected visible differences are limited to verified source metadata, more specific inline errors, and recovery copy for expired preparations.

## Runtime Responsibility Map

- React/TanStack owns URL input, generated Convex action calls, display state, preparation IDs, typed copy, and duplicate-submit prevention.
- `api.sourceActions.submitManualUrl` owns authentication, target authorization, intake rate limits, metadata inspection, bounded retries, attempt telemetry, and typed results.
- Convex internal mutations own preparation persistence/expiration, active-run revalidation, pending-source insertion, and atomic preparation consumption during launch.
- `manualSourcePreparations` is a short-lived receipt/cache, not a source, corpus member, evidence record, or workflow authority.
- Presentation helpers map structured intake codes to analyst labels, consequences, and next actions.

## Locked Public And Domain Interfaces

- `ManualSourceIntakeErrorCode`: `invalid_url`, `https_required`, `credentials_not_allowed`, `custom_port_not_allowed`, `non_public_destination`, `dns_failed`, `redirect_limit`, `request_timeout`, `connection_failed`, `access_blocked`, `not_found`, `upstream_rate_limited`, `upstream_unavailable`, `unsupported_content_type`, `response_too_large`, `duplicate_source`, `candidate_limit`, `intake_rate_limited`, `preparation_expired`, `dossier_not_accepting_sources`, `stale_execution`, `not_authenticated`, `not_authorized`, `unexpected`.
- Public action: `api.sourceActions.submitManualUrl({ requestKey, url, target })`.
- Pre-launch target: `{ kind: "prelaunch", collectionKey }`.
- Active-run target: `{ kind: "run", runId, corpusRevisionId }`.
- Prepared result: `{ kind: "prepared", preparationId, canonicalUrl, title, expiresAt }`.
- Persisted result: `{ kind: "persisted", sourceId, canonicalUrl, title }`.
- Expected failure: `ConvexError<{ area: "manual_source_intake"; code: ManualSourceIntakeErrorCode; retryable: boolean; field?: "url"; preparationId?: Id<"manualSourcePreparations"> }>`.
- Launch replaces `manualSourceUrls?: string[]` with `manualSourcePreparationIds?: Id<"manualSourcePreparations">[]`.
- `insertPendingManualSource(ctx, input)` owns source, pending decision, review projection, and audit creation.

## Task Dependency Order

### Task 1: Typed Intake Contract

**Outcome:** Backend and presentation code share one stable failure taxonomy.

**Files:**
- Create: `convex/domain/manualSourceIntake.ts`
- Create: `src/__tests__/convex/sources/manual-source-intake.test.ts`
- Create: `docs/decisions/016-centralize-manual-source-intake-with-expiring-preparations.md`
- Modify: `context/TECH.md`
- Modify: `docs/product-designs/2026-07-20-agentic-resilience-evidence-workbench-design.md`

**RED:** Import the missing classifier and assert representative URL-policy, HTTP, timeout, network, lifecycle, duplicate, limit, and unknown failures map to stable codes and retryability.

Run: `pnpm vitest run src/__tests__/convex/sources/manual-source-intake.test.ts`

Expected: FAIL because the public domain module does not exist.

**GREEN:** Add the typed error payload, constructor, guard, and classification helpers only.

Run: `pnpm vitest run src/__tests__/convex/sources/manual-source-intake.test.ts && pnpm typecheck`

### Task 2: Robust Metadata Inspection And Retry

**Outcome:** Both contexts use one inspector, public PDFs are prepared without body download, and only retryable failures receive one fresh retry.

**Files:**
- Modify: `convex/domain/publicSourceUrl.ts`
- Modify: `convex/sourceActions.ts`
- Modify: `convex/providerCalls.ts`
- Modify: `src/__tests__/convex/sources/public-source-url.test.ts`
- Modify: `src/__tests__/convex/sources/manual-url-telemetry.test.ts`

**RED sequence:** Large public PDF headers succeed without body download; timeout succeeds on attempt two; `403` and unsupported content do not retry; two retryable failures return the typed code; telemetry stores attempts one and two with stable codes.

**GREEN:** Put the retry loop around the shared inspector, preserve address pinning and redirect validation, and add a header-only PDF inspection path.

### Task 3: Preparations And Single Public Action

**Outcome:** Composer and active dossier call `submitManualUrl`; receipts are server-owned; pending candidate persistence has one owner.

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/rateLimiter.ts`
- Modify: `convex/sourceActions.ts`
- Modify: `convex/sources.ts`
- Modify: `convex/researchLaunch.ts`
- Modify: focused Convex tests under `src/__tests__/convex/sources/` and `src/__tests__/convex/research-runs/`

**RED sequence:** Authenticated anonymous users can prepare before admission; unauthenticated and rate-limited requests stop before I/O; replay returns the same receipt; active-run non-owners stop before I/O; owners persist one pending source; duplicates are typed; stale generations cannot persist; launch consumes valid receipts atomically; expired or foreign receipts create no run and consume no quota; idempotent launch replay survives consumed receipts.

**GREEN:** Add `manualSourcePreparations`, rate-limit guards, internal receipt mutations, `insertPendingManualSource`, and the target-union action. Remove `prepareLaunchUrls`, `prepareLaunchManualSources`, and `addManualUrl` after all callers migrate.

### Task 4: Composer, Dialog, Dossier, And Copy

**Outcome:** Add verifies immediately, only prepared references appear in the composer, active dossiers use the same action, and failures explain recovery without leaking internals.

**Files:**
- Modify: `src/components/workspace/research-composer.tsx`
- Modify: `src/components/workspace/add-source-dialog.tsx`
- Modify: `src/components/workspace/run-route-component.tsx`
- Modify: `src/components/workspace/source-review.tsx`
- Modify: `src/components/workspace/evidence-sufficiency-review.tsx`
- Modify: `src/components/workspace/live-source-review.tsx`
- Modify: `src/lib/presentation/research-copy.ts`
- Modify: focused component and route tests under `src/__tests__/`

**RED sequence:** Composer calls `submitManualUrl` before company selection and renders canonical metadata; canonical duplicates are not listed twice; failed input remains editable with actionable copy; launch sends only preparation IDs; expired receipts render re-verification guidance; active review sends the run target; raw backend details never render.

**GREEN:** Replace local URL strings with prepared-reference objects, keep target choice in feature owners, and map only structured intake errors with a generic fallback.

### Task 5: End-To-End Certification

**Outcome:** Both journeys are proven against real Convex state and no legacy runtime callers remain.

**Files:**
- Create: `docs/verification/2026-08-06-centralized-manual-source-intake.md`
- Modify: this plan's status and completed checkboxes.

**Automated gates:** `pnpm convex:check`, `pnpm check`, `git diff --check`, and a repository search showing no runtime `manualSourceUrls`, `prepareLaunchUrls`, `prepareLaunchManualSources`, or `api.sourceActions.addManualUrl` references.

**Protected browser gate:** With analyst access, add a source during evidence-sufficiency or source review, observe it as pending through reactive Convex state, reload, and verify persistence.

**Start browser gate:** Before company selection, prepare a public reference, verify canonical metadata, select a company, admit if needed, launch once, and verify the reference in corpus revision one at source review.

## Security And Durable-Execution Matrix

- Pre-launch authorization requires a Convex Auth identity and bounded collection/request keys.
- Active-run authorization requires visitor ownership, accepted lifecycle/revision state, and the current execution generation.
- Apply global and per-user metadata limits before DNS or HTTP work.
- Trim and bound input lengths; validate HTTPS, credentials, port, DNS addresses, redirects, content type, response size, and metadata output.
- Preserve five redirects and ten-second timeout; cap HTML title inspection at 2 MiB.
- Do not download PDF bodies during preparation.
- Use at most two attempts for timeout, connection, `429`, and `5xx`; record every attempt.
- Pre-launch idempotency binds Auth identity, collection key, request key, and normalized input digest.
- Active-run idempotency binds run, workflow version, execution generation, corpus revision, step, request key, and URL digest.
- Recheck generation and revision before active-run persistence; recheck Auth ownership before preparation persistence and launch consumption.
- Store stable application codes, attempt, latency, and canonical metadata; never store page bodies, secrets, raw exceptions, or private addresses.
- Expire unconsumed receipts; consume valid receipts atomically; return an existing run before requiring deleted receipts on launch replay.

## User-Facing Copy Contract

- Invalid or unsafe URL: “Use a public HTTPS link without credentials or a custom port.”
- Private/reserved destination: “That link does not point to a public source. Use a publicly accessible HTTPS page or PDF.”
- DNS failure or not found: “We couldn’t find that source. Check the link or use another public page.”
- Timeout, connection, or `5xx`: “The source site didn’t respond. Try again shortly or use another public link.”
- Access blocked: “The source site blocked access. Use another public link to the same document.”
- Upstream rate limit: “The source site asked us to slow down. Try again shortly.”
- Unsupported type: “That link is not a supported webpage or public PDF.”
- Oversized HTML: “That page is too large to verify here. Use a direct report page or public PDF link.”
- Duplicate: “This source is already in the dossier.”
- Expired preparation: “This reference needs to be verified again before starting the dossier. Reopen references and add it again.”
- Dossier state: “This source set is no longer accepting additions. Refresh the dossier to see its current stage.”
- Session/permission: “Your workspace access changed. Reconnect, then try again.”
- Unexpected: “We couldn’t verify that source. Try again.”

## Verification Matrix

| Exit criterion                          | Deterministic test              | Browser proof                                         | Live proof              | Blocking |
| --------------------------------------- | ------------------------------- | ----------------------------------------------------- | ----------------------- | -------- |
| Composer validates immediately          | Start route test                | Desktop and narrow mobile Start                       | One approved public URL | Yes      |
| Launch persists receipts atomically     | Convex launch test              | Source visible in revision one                        | Same approved URL       | Yes      |
| Active dossier uses the same action     | Convex action and route test    | Protected Source Review                               | One approved public URL | Yes      |
| Retry is bounded and selective          | Inspector and telemetry tests   | Not required                                          | Optional smoke          | Yes      |
| Errors are specific and safe            | Copy and component tests        | Invalid plus simulated failure states                 | Not required            | Yes      |
| SSRF and redirect pinning remain intact | Public URL tests                | Not required                                          | No private targets      | Yes      |
| Existing UI remains stable              | Component tests                 | Baseline comparison, keyboard, mobile, reduced motion | Not required            | Yes      |
| Legacy workflow is removed              | Typecheck and repository search | Not required                                          | Not required            | Yes      |

## Live And Browser Gates

- Real public-URL calls require explicit approval before execution and are limited to one HTML request and one public-PDF header request.
- Protected gates must use an intended admitted analyst session; unauthenticated rejection is not a substitute.
- Inspect desktop and narrow-mobile states, keyboard/focus behavior, loading, error recovery, reduced motion where affected, fresh post-action state, and browser console output.
- Private URL, hostile status, timeout, oversized content, authorization, duplicate, capacity, expiration, and stale-generation cases remain deterministic tests rather than live hostile calls.

## Self-Review And Known Deferrals

- The plan preserves public reference entry, source review, analyst authority, and the existing UI composition.
- Preparations are short-lived metadata only. Restoring composer drafts after a full reload remains out of scope.
- Retrieval, normalization, extraction, and per-source retrieval-failure UI remain Phase 5 work.
- Longer-lived research drafts require a separate product decision and cannot be smuggled into preparation receipts.