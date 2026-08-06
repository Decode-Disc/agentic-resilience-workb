# Phase 4 Closure Verification

Date: 2026-08-06

Status: **Phase 4 closure passed**.

This report covers only Phase 4 company and corpus discovery. No Phase 5
extraction behavior was added.

## Implemented contracts

- SEC CIK is the sole company identity used during authoritative
  revalidation. Ticker, legal name, exchange, and URLs are refreshable
  metadata. Existing commercial website metadata is retained when SEC does not
  supply a replacement.
- Workflow resumes claim the visitor execution slot and increment
  `executionGeneration` exactly once in the same mutation. Durable transitions,
  persistence, handoffs, callbacks, and events reject a stale generation.
- The former public `researchRuns.reserve` entry point is removed. Company
  confirmation, preflight revalidation, quota reservation, and run creation
  remain atomic through `researchLaunch.confirmAndStart`.
- SEC and Exa calls now have bounded attempts, application timeouts, leases,
  rate limits, paid-work authorization, typed missing/timeout/partial outcomes,
  and provider-call telemetry. Late, cancelled, expired-lease, and stale-
  generation results cannot advance business state.
- Exa discovery validates candidates independently. Valid candidates survive
  invalid neighbors, an all-invalid response is not retried as a false success,
  and persistence plus provider completion are atomic or replayable.
- Company favicon resolution consults the CIK cache before Exa, refreshes after
  30 days, retains stale metadata on refresh failure, and falls back to the SEC
  investor-relations host and then the existing company icon.
- Direction-aware tabs support roving focus, Arrow/Home/End navigation,
  `aria-controls`/`aria-labelledby`, and reduced motion without changing the
  established directional treatment.
- Source Review has layout-preserving loading geometry and an explicit empty
  event-history state. Administration leads with readable product labels while
  keeping raw lifecycle and provider diagnostics secondary and protected.
- Vitest is limited to four workers with per-file isolation. Canvas and Paper
  Shader are neutralized only at the unit-test boundary.
- ADR-015 records why bounded Exa visual enrichment may use provider credits
  before admission without consuming a visitor analysis reservation.

## Automated verification

| Gate | Evidence | Result |
|---|---|---|
| Focused Convex suites | 25 files, 142 tests | Passed |
| Focused changed UI coverage | 13 tests | Passed |
| Full suite, consecutive run 1 | 64 files, 283 tests, 65.23 s | Passed |
| Full suite, consecutive run 2 | 64 files, 283 tests, 63.11 s | Passed |
| Final isolated `pnpm check` after live verification | typecheck, lint, format, 64 files / 283 tests in 52.68 s, production build | Passed |
| `pnpm convex:check` | generated Convex contracts and deployment checks | Passed |
| `git diff --check` | working-tree whitespace validation | Passed |

The final client build reports the known non-blocking landing chunk warning at
514.50 kB raw / 157.59 kB gzip. No test timeout was increased to obtain the
green runs.

One post-live full-suite attempt was run while Convex/Vite and two isolated
Chrome sessions were still active; seven UI assertions timed out without a
functional assertion failure. No test or timeout was changed. After those
processes were stopped, the three affected files passed 35/35 and the unchanged
full gate passed 283/283 in 52.68 seconds.

Required deterministic cases covered by the changed suites include mutable
company metadata under a stable CIK, CIK mismatch, duplicate decisions,
concurrent runs, stale generations, provider cancellation, expired leases,
late results, disabled paid work, timeouts, absent configuration, partial Exa
batches, and replay without duplicate external work.

## Browser verification without live provider calls

Chrome DevTools AXI was run in isolated named sessions against the local app.
No live SEC or Exa contract was triggered.

Analyst path:

- authenticated with an analyst access code and opened an existing dossier;
- observed an existing dossier at the persisted approved-corpus handoff with
  the ready/idle presentation and its persisted progress history;
- reloaded and observed the same event history;
- verified Source Review master/detail behavior on desktop, including 12/24
  loaded and 24/48 candidates, and the source-detail drawer at 390 x 844;
- exercised DirectionAwareTabs from Preview to Source details using
  `ArrowRight`, with focus and selection following the active tab;
- logged out, confirmed that the prior private dossier route was denied, then
  reconnected with the same reusable code and recovered the same visitor role,
  dossier, and quota context;
- confirmed that the analyst identity was denied access to the administration
  route.

Administrator path:

- authenticated with an administrator access code and opened the protected
  administration route;
- observed readable lifecycle and provider labels before secondary diagnostics;
- disabled the paid-work switch with an audited reason, verified the disabled
  state, and restored it with a second audited reason;
- verified the final paid-work state was enabled.

Accessibility and runtime path:

- verified desktop and 390 x 844 mobile layouts using fresh post-action AXI
  snapshots;
- verified normal-motion and forced reduced-motion sessions independently;
- found and repaired a reduced-motion SSR hydration mismatch in the landing
  motion boundary;
- reopened a fresh page in both modes and observed no browser console errors.

The pre-change visual baselines are retained at:

- `docs/verification/assets/phase-4/before-start-desktop.png`
- `docs/verification/assets/phase-4/before-start-mobile.png`
- `docs/verification/assets/phase-4/before-source-review-desktop.png`
- `docs/verification/assets/phase-4/before-source-review-mobile.png`

Fresh after-change AXI snapshots were inspected for each changed surface. The
AXI session did not materialize requested after-change PNG files in the
workspace, so this report does not claim that those files exist.

## Bounded live provider contracts

The user explicitly approved these calls before execution. The contracts used
metadata-only requests and did not request page contents.

| Contract | Bound and observed result | Latency | Provider-reported cost |
|---|---|---:|---:|
| SEC company evidence | 1 request for CIK `1818201`; canonical CIK and response shape verified without a ticker assertion | 607 ms | Public endpoint |
| Exa discovery | 1 request; 2 results accepted, 0 rejected; provider search time 573.3 ms | 1,061 ms | USD 0.007 |
| Exa company website | 1 request; `servicenow.com` resolved; provider search time 1,570.9 ms | 1,993 ms | USD 0.007 |

## New live browser run

A genuinely new ServiceNow dossier was started after stabilization. The public
flow resolved CIK `1373715`, rendered the cached/resolved commercial favicon,
confirmed the company, consumed one analyst reservation, and reached Source
Review with 28 persisted candidates. The analyst accepted one SEC filing and
approved corpus revision 1; the remaining pending candidates were retained and
excluded from the approved corpus.

Authoritative Convex inspection after approval recorded:

- `lifecycleState = corpus_approved`;
- `executionStatus = idle`;
- `executionGeneration = 2`;
- one approved source-review checkpoint and one approved corpus revision;
- 14 ordered persisted `RunEvent` records ending at `corpus_approved`;
- no `extracting_evidence` state and no extraction event.

Opening the run again from its URL reconstructed `Source set approved` and
`Ready` from the persisted run and displayed the same complete event history.
The same result was then repeated in one fresh AXI session after the final local
gate, and the browser console remained free of errors.

Browser-run provider telemetry stayed below the approved ceilings:

| Boundary | Ceiling | Observed | Latency evidence | Cost |
|---|---:|---:|---|---:|
| SEC | 6 requests | 3 successful requests | 1,188 ms search; 571 ms preflight; 686 ms launch revalidation | Public endpoint |
| Exa | 16 searches | 6 successful searches | 422 ms website lookup; discovery calls from 1,264 to 1,670 ms | USD 0.042 |

The six Exa calls comprise one five-result metadata-only company lookup and five
four-result discovery searches. They accepted 25 candidates in total, rejected
none, and reported individual costs of USD 0.007. Across the two standalone Exa
contracts and the browser run, the provider-reported total was USD 0.056.

All Phase 4 and Demonstration Checkpoint A items in `docs/ROADMAP.md` are now
checked. Phase 5 remains untouched.
