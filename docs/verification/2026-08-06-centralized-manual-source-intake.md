# Centralized Manual Source Intake Verification

Date: 2026-08-06

Status: **Implementation and deterministic certification passed. Two bounded
live workflow gates remain unclaimed.**

## Implemented contracts

- Every analyst-added URL enters through
  `api.sourceActions.submitManualUrl({ requestKey, url, target })`.
- Pre-launch intake returns a short-lived, server-owned preparation receipt.
  Launch accepts preparation IDs only and atomically consumes valid receipts
  while creating pending candidates in corpus revision one.
- Active dossier intake uses the same public action and the same pending-source
  persistence helper. Authorization, lifecycle, capacity, duplicate, and stale
  execution checks occur before durable candidate insertion.
- Expected failures cross Convex boundaries as a closed
  `manual_source_intake` code union with explicit retryability. Presentation
  code maps structured data to analyst-safe recovery copy and does not render
  raw backend errors.
- URL inspection preserves public-HTTPS-only validation, DNS and redirect
  checks, validated-address connection pinning, Host and TLS SNI, five redirects,
  a ten-second timeout, a 2 MiB HTML bound, and header-only PDF preparation.
- Retry is limited to timeout, connection, upstream rate-limit, and upstream
  unavailable failures, with at most two attempts and stable telemetry codes.
- Metadata inspection is limited to 60 requests per 15 minutes globally and 12
  per authenticated identity.

## Automated verification

| Gate                  | Evidence                                                                                                                                 | Result |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm convex:check`   | Convex functions generated and became ready in 9.06 s                                                                                    | Passed |
| `pnpm check`          | typecheck, lint, format, 67 files / 327 tests, client build, SSR build                                                                   | Passed |
| Full Vitest suite     | 67 files, 327 tests in 87.21 s                                                                                                           | Passed |
| Production build      | client in 4.04 s; SSR in 1.12 s                                                                                                          | Passed |
| `git diff --check`    | working-tree whitespace validation                                                                                                       | Passed |
| Runtime legacy search | no `manualSourceUrls`, `prepareLaunchUrls`, `prepareLaunchManualSources`, or old `addManualUrl` action references outside tests/docs/tmp | Passed |
| VS Code diagnostics   | no workspace errors                                                                                                                      | Passed |

The final gate completed with `CHECK_EXIT_CODE=0`. The client build retains the
known non-blocking chunk warning for `index` at 516.25 kB raw / 158.19 kB gzip.

Deterministic coverage includes:

- typed URL-policy, DNS, HTTP, timeout, network, lifecycle, authorization,
  duplicate, capacity, expiration, rate-limit, stale-execution, and unknown
  failures;
- public-address pinning across redirects and public PDF preparation without
  body reads;
- fresh selective retry with per-attempt telemetry;
- authenticated pre-launch preparation, replay before rate limiting or network
  work, and expired request-key rejection;
- active-run ownership checks before inspection, replay without duplicate
  external work, workflow-version and step-bound operation identity, duplicate
  rejection, and stale-generation rejection;
- atomic launch consumption, foreign and expired receipt rejection without run
  creation or quota reservation, and launch replay after receipt consumption;
- Start composer canonical deduplication, preparation-ID-only launch, expired
  reference recovery, protected-route target wiring, and safe error copy.

## Browser verification

Chrome DevTools AXI verified the local application in an authenticated analyst
session without claiming a successful live public-source contract.

Start composer at 1440 x 900 and 390 x 844:

- clicking and editing inside the portalled Add Source dialog did not close the
  dialog or collapse the composer toolbar;
- invalid or failed input remained editable and focused with analyst-safe copy;
- Escape and Done closed the dialog and restored focus to Attach references;
- the narrow layout had no horizontal overflow or overlapping controls;
- no application console errors were present after the final checks.

Protected dossiers:

- analyst admission restored the two existing private dossiers;
- reload preserved their persisted approved source sets and event history;
- both dossiers were already `corpus_approved`, so source-add controls were
  correctly unavailable;
- browser inspection found misleading recovery copy that still advertised a
  manual add action after approval;
- a failing route test was added first, `RunProgress` was made lifecycle-aware,
  and the focused route suite then passed 5/5;
- Chrome confirmed the approved-state sentence was present and the stale
  "you can add a public source manually" sentence was absent;
- the final protected-page console contained no errors.

The screenshot command reported `/manual-source-approved-progress.png`. The
file was not retained in the workspace, so this report does not claim a durable
PNG artifact.

## Unclaimed live gates

No successful real public URL preparation or launch-time receipt conversion was
performed because a bounded external request requires explicit user approval.
The deterministic inspector, receipt, launch, and UI suites cover those
contracts, but they are not substitutes for that approved live call.

The protected add-and-reload gate was also not performed because both available
analyst dossiers are already immutable approved revisions. No paused review
dossier was manufactured or reopened solely to satisfy verification. The
active-run action, persistence, replay, authorization, and route wiring are
covered deterministically.

These are environment and approval constraints, not known implementation
failures. Completing either gate later must preserve the request ceilings and
must not mutate an approved corpus revision.