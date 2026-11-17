# Source discovery recovery and coverage review

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Started: 2026-10-19. Final verification continued on 2026-10-20 (Africa/Lagos). Candidate: working tree based on `f3c0080`. This report covers explicit failed-discovery retry, targeted requirement searches, current coverage feedback, and live approved-source retrieval contracts. It supplements historical Phase 5 verification without replacing failed or deferred evidence.

Subsequent repairs and fresh live certification are recorded in [Source recovery and live retrieval contract repairs](2026-10-20-source-recovery-contract-repairs.md). The failed contracts and earlier browser limitations below describe the earlier candidate and are preserved.

## Implemented behavior

The draft source proposal distinguishes searches that could not complete from source requirements that remain unconfirmed. Retry failed searches targets the failed discovery families. Each coverage requirement offers candidate inspection and a targeted metadata search. The existing Add source link action, public-HTTPS intake dialog, desktop toolbar, and mobile Source actions menu remain available. Coverage gaps remain visible as compact controls. Each opens its candidate-review and targeted-search actions in a contextual popover, keeping approval visible without repeating action rows.

The current coverage projection uses effective inclusion and persisted candidate eligibility. Removing or restoring a qualifying source changes coverage without rewriting the immutable proposal. Manual links and metadata-only linkage do not establish automatic coverage. Recomputing a proposal preserves unresolved discovery warnings. Approval remains subject to the existing checkpoint and is blocked server-side while recovery is active.

Recovery extends the existing proposal-rebuild machinery. Owner authorization precedes I/O. Revision, generation, expected proposal, policy, target, request identity, and an active lease fence dispatch and persistence. Only one recovery can run per draft revision. Completed and expired request replays cannot dispatch another paid call; a new explicit request is required. Candidate limits, emergency paid-work controls, bounded retries, timeout abortion, failure telemetry, and immutable proposal history remain enforced. Start and completion are persisted run events. No new workflow engine, dependency, model call, cloud deployment, port configuration, or historical-data backfill was introduced.

## RED and focused evidence

Focused tests ran through the real Convex function boundary and the real source-review components. External HTTP, DNS, and clocks were mocked only where required. The initial coverage regression failed because excluding an annual filing left its coverage gap hidden. The recovery action initially failed because its public boundary did not exist. Additional probes reproduced missing persisted progress, late candidate persistence after lease expiry, missing retryability, warning loss on recommendation refresh, and another paid request when replaying a blocked request after its cooldown. The new UI regression failed on the missing actionable warning and controls. The guarded recovery fixture initially rejected its new scenario argument.

Commands used `node node_modules/vitest/vitest.mjs run <file> -t <case> --maxWorkers=1` during implementation. Targeted failures and subsequent results are retained under `/tmp/source-recovery`, including `fixture-red.log`, `fixture-green.log`, `replay-red.log`, `replay-green.log`, `expired-replay-red.log`, and `expired-replay-green.log`. The expired-replay parametrized probe also encountered cold-import test timeouts; preloading the real Node action module moved its import work outside the per-test deadline. That timeout is not presented as proof of the missing replay behavior.

The final affected command was `pnpm test src/__tests__/convex/sources/source-selection-proposal-rebuild.test.ts src/__tests__/convex/e2e/source-review-fixture.test.ts src/__tests__/components/workspace/source-proposal-review.test.tsx src/__tests__/components/workspace/live-source-review.test.tsx --maxWorkers=1 --silent`: 64 passed across four files. Evidence: `/tmp/source-recovery/affected-final.log`. Backend cases cover authorization, target-specific queries, preservation of unrelated failures and analyst decisions, idempotency, concurrent targets, request timeouts without overlapping HTTP attempts, capacity exhaustion, manual-link limitations, approval races, and expired leases. The fixture unit case uses a configured three-source limit to exercise the same capacity boundary cheaply; browser scenarios fill the normal configured capacity.

An earlier affected run recorded 57 passed and one existing tooltip-test timeout. Its isolated check passed without increasing a timeout or weakening an assertion. Earlier implementation logs retain expected red tests and a temporary duplicate-import failure corrected before the final affected gate.

## Live retrieval contracts

The authorized command was `RUN_LIVE_PROVIDER_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/__tests__/live/sec-evidence-retrieval.contract.test.ts src/__tests__/live/exa-contents.contract.test.ts --maxWorkers=1 --reporter=verbose`, with temporary directories bound to `/tmp`. It explicitly loaded the ignored local configuration and ran only the two named contracts. Both tests failed. Evidence: `/tmp/source-recovery/live-contracts.log`.

| Provider | Frozen source | Observed requests | Latency | Result |
| --- | --- | --- | --- | --- |
| SEC | CIK `1818201`, accession `0001818201-24-000010`, document `cccs-20231231.htm` | 1 HTTP request | 501 ms | Acquisition failed with the existing generic `Error` classification. No bytes or passages were produced. |
| Exa Contents | `https://www.cccis.com/insurance-carriers/apd` | 1 SDK Contents call | 793 ms | HTTP 400. No bytes or passages were produced. |

Neither contract reproduced a locator, and neither reported a cost. These results establish attempted live requests and failures, not provider certification or an identified root cause. No test assertion or frozen source identity was changed, no additional paid diagnostic request was issued, and the existing ServiceNow dossier was not retried. The first Phase 5 retrieval checkbox remains unchecked. Real Unstructured and model-provider work remain deferred.

## Browser evidence

Browser checks used the existing local Convex and Vite services, system Chrome, normal anonymous sign-in, and the configured analyst access slot. Guarded internal fixtures use production source projections and decisions. Recovery buttons invoke the actual protected action; fixture capacity prevents provider I/O, and internal inspection confirms zero provider-call records. Source removal and restoration change the real reactive coverage projection. Tests include reload/reconnection, normal approval availability, context inspection, existing link intake, and desktop/mobile source actions.

The first run failed because its test used a button selector for the Alternatives tab. Correcting that selector produced two passing protected desktop/mobile tests, retained in `/tmp/source-recovery/playwright-functional.log` and `playwright-functional-results`. The subsequent run adds keyboard retry, dialog focus restoration, and the bounded coverage region. Original failures remain in `playwright-initial.log` and `playwright-initial-results`. Tests use reduced motion and sanitized tracing only after admission closes. Admission material and browser storage are not included in artifacts.

Baseline screenshots are `before-desktop.png` and `before-mobile.png` under `/tmp/source-recovery`. The original mobile baseline retains the expanded navigation overlay. After-change fixture screenshots are `after-desktop.png` and `after-mobile.png`; comparison is behavioral and structural, not a claim of pixel equivalence between different dossiers.

## Quality and operational boundaries

`pnpm check` passed client and Convex type checking, then stopped on a pre-existing array-index-key lint error in `src/components/workbench-shell/analyzed-company-list.tsx`. Its task-file non-null-assertion warning was corrected afterward. No unrelated file was reformatted or lint rule weakened. Task-file lint passed, and import checks were run separately because the lint failure stopped the command chain. The complete verification results are recorded below. Repository-wide formatting reports 23 files; the formatter JSON report confirms that none is modified by this task.

The normal `pnpm` launcher did not complete in the restricted execution environment. Verification used the already-installed, matching pnpm 10.20.0 executable from its local cache, without installing or changing dependencies. That executable reports an embedded Node 20.11.1 engine warning; the shell and `pnpm exec node --version` both reported Node 24.18.0. Playwright also reports the existing NO_COLOR/FORCE_COLOR environment warning. These warnings were not suppressed.

The attempted task-owned `convex dev` start exited because the local deployment was already running, leaving no additional dev server. Existing services were reused rather than stopped. Browser teardown removes the local E2E fixture flag. No commit or publication is part of this implementation request.


## Integration-harness repair found by the full gate

The first full suite recorded 829 passed, six failed, and two runner errors. Five failures came from route tests missing the newly required recovery action mock; those fixtures now register the real generated reference through the shared harness. The remaining failure was the SEC workflow tracer's scheduler drain. Its timeout test and following end-to-end test reproduced the failure as a pair, while the end-to-end test passed alone. The diagnostic snapshot showed the following run already paused at claim-generation unavailability with a succeeded source and no scheduled root jobs, yet the scheduler drain still failed and the runner's globals were damaged.

The preceding timeout case ran a direct acquisition action with real timers while the same approved run had scheduled its durable workflow, and it left a ten-millisecond SEC timeout override in the process environment. The repair drives timeout acquisition through that single real workflow under the fake clock, checks exactly two fetch attempts and the persisted timeout failure, restores stubbed environment values after each case, and preloads the real Node action module before the workflow harness changes runtime globals. The isolated timeout/end-to-end pair then passed without runner errors. No production timeout, scheduler iteration limit, or domain assertion was relaxed. Diagnostics remain in `sec-timeout-pair.log` and `sec-scheduler-diagnostic.log`; repaired evidence is in `sec-timeout-pair-fixed.log` and `full-failures-fixed.log`.


## Final verification results

| Check | Final result | Evidence |
| --- | --- | --- |
| Affected recovery, source-review, and guarded-fixture suites | 64 passed across 4 files | `affected-final.log` |
| Repaired route and SEC provenance integration suites | 33 passed across 2 files, no runner errors | `full-failures-fixed.log` |
| Full default four-worker suite with live provider execution disabled | 835 passed across 115 files, no runner errors | `full-suite-final.log` |
| Protected desktop/mobile recovery journey | 2 passed, including keyboard retry, dialog focus restoration, reload, coverage updates, and zero provider calls | `playwright.log` |
| Client and Convex type checking | Passed in `pnpm check`; final client check also passed after test-fixture repairs | `check.log`, `typecheck-final-client.log` |
| Task-file lint | Passed, 18 files checked | `lint-task-final.log` |
| Import contract check | Passed | `imports.log` |
| Production build | Passed, client and server bundles | `build.log` |
| Repository lint | Failed on one unchanged skeleton-key issue outside task scope | `check.log` |
| Repository formatting | Failed on 23 unchanged files outside task scope; no overlap with task changes | `format-check.log`, `format-full.json` |
| Live SEC retrieval contract | Failed after 1 HTTP request, generic acquisition error | `live-contracts.log` |
| Live Exa Contents contract | Failed after 1 SDK call, HTTP 400 | `live-contracts.log` |
| Browser fixture flag cleanup | Confirmed not enabled on the local deployment | Bounded read of `E2E_FIXTURES_ENABLED` after teardown |

All listed logs are under `/tmp/source-recovery`. Source/test hashes in `candidate-hashes.json` were unchanged during the final full-suite run. The full suite emits expected negative-case error-boundary diagnostics and workflow status reports; it completed with no unhandled runner errors. No production or test source changed after that run. The final report was completed afterward.

Same-dossier after-change screenshots are `actual-after-desktop.png` and `actual-after-mobile.png`. They retain the original source decisions and discovery limitation while showing the new recovery controls. No recovery was invoked on that dossier. Existing local development services remain running; all task browser processes closed. No additional dev server, cloud deployment, dependency change, credential rotation, commit, or publication was performed.

The next bounded follow-up is to diagnose the existing SEC acquisition error and Exa Contents HTTP 400 using safe provider diagnostics and an explicitly bounded request budget. Until those contracts succeed, live approved-source retrieval remains uncertified and the roadmap checkbox remains open. Repository-wide lint and formatting cleanup is a separate scope.


## Compact warning refinement, 2026-10-20

The initial recovery layout exposed two buttons for every gap and placed the retry beneath a long explanation. The refinement keeps the two meanings separate while restoring compact summaries. The search warning now uses a short message and one quiet retry action beside it. Each coverage label opens its own existing candidate-review and targeted-search actions. The approval limitation is explained inside that popover. The original Add source link, desktop toolbar, mobile Source actions, source decisions, and server recovery boundaries remain intact. Approved revisions show passive coverage labels.

Protected before and after captures use the same ServiceNow dossier. The final desktop search warning is approximately 74 pixels high and coverage warning 80 pixels high. At 390 pixels wide with navigation collapsed, they are 152 and 224 pixels high. Captures and measurements are under `/tmp/source-warning-refinement`, with the original desktop baseline retained as `/tmp/source-recovery/refinement-before-desktop.png`. These measurements describe this dossier and viewport, not all possible gap counts.

The focused regression first failed because the new compact retry control was absent. It now verifies that per-gap actions are hidden until the relevant label is opened, dispatch the same recovery targets, close after a search, and preserve access to the existing inspector. Additional checks cover pending feedback, duplicate activation, and passive approved-state labels. Two exploratory component runs reached the five-second per-test deadline. A later isolated run passed all 33 then-current component tests. No timeout or assertion was weakened. Final verification results follow below.


The stricter browser console gate initially failed on third-party favicon responses for fixture domains. The trace identifies a 404 from `t3.gstatic.com/faviconV2`. The browser test now supplies a deterministic image only at the external Google favicon boundary. Authentication, admission, queries, mutations, recovery actions, and console assertions remain real. The initial failing trace and log remain in `/tmp/source-warning-refinement/playwright-favicon-failure-results` and `playwright-favicon-failure.log`.


Final refinement verification:

- `RUN_LIVE_PROVIDER_TESTS=0 pnpm test --maxWorkers=2 --reporter=dot`: 836 tests passed across 115 files, no runner errors. The full suite includes the 34 source-review component tests after the pending-state characterization was added. Log: `/tmp/source-warning-refinement/full-suite.log`.
- `pnpm exec playwright test --config /tmp/source-warning-refinement/playwright.config.ts e2e/source-recovery-reactivity.spec.ts`: both protected desktop/mobile journeys passed against the final component, including real recovery capacity responses, source decisions, reactive coverage updates, keyboard opening and dismissal, focus return, link intake, reconnection, no horizontal overflow, and console checks. Internal inspection confirms zero provider-call records. Log: `/tmp/source-warning-refinement/playwright-final.log`.
- Focused Biome lint and formatting pass for both edited component files. Import checks and `git diff --check` pass. Repository-wide formatting still reports 23 unchanged files. The JSON diagnostic paths have no overlap with modified files.
- `pnpm check` passes both typechecks before stopping at the unchanged array-index-key error in `src/components/workbench-shell/analyzed-company-list.tsx:114`. Its remaining chained checks are recorded separately rather than presented as having run through that command. Log: `/tmp/source-warning-refinement/check.log`.

This refinement changes no provider, recovery, authorization, schema, port, or deployment contract. The earlier failed live SEC and Exa Contents contracts remain failed historical evidence. They were not rerun for this visual correction. Existing local services were reused and no additional dev script was launched.


After the final component refactor and pending-state test, `pnpm typecheck` passed for both the client and Convex, and `pnpm build` passed for client and server. Logs: `/tmp/source-warning-refinement/typecheck.log` and `build.log`. Final fully opened popover screenshots wait for full opacity, avoiding an earlier capture during its entrance transition. Read-only captures also confirm Escape returns focus to the originating gap on both viewport sizes. Final previews are `summary-desktop.png`, `summary-mobile.png`, `gap-actions-desktop.png`, and `gap-actions-mobile.png` in `/tmp/source-warning-refinement`.
