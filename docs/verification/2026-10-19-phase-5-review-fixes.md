# Phase 5 review repairs

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-19. Scope: the retrieval, replay, approval handoff, question backfill, manual reference routing, timeout cancellation, and PDF acquisition defects identified during Phase 5 review. Existing working-tree changes were retained. This record supplements the historical Phase 5 verification report and does not supersede its failed or unrun checks.

## Behavior and regression evidence

| Boundary | Observed failure before repair | Repaired behavior and regression coverage |
| --- | --- | --- |
| Frozen source query | Stored discovery ranking fields and acquisition failure reasons failed return validation. | Full source and status validators derive from the Convex schema. The query regression returns all persisted fields. |
| Approved corpus continuation | Approval ended at an idle approved corpus with no application path into evidence preparation. | The final discovery handoff validates the approved checkpoint and starts extraction in one transaction. Duplicate delivery starts once, execution-slot conflicts roll back, and late discovery completion preserves the new workflow handle. |
| Retrieval replay | Replaying the SEC action downgraded a committed source to failed after its provider lease refused another call. | Retrieval actions reuse matching committed terminal versions before status changes or I/O. Late failure writes preserve succeeded and partial evidence. Regressions compare provider calls, versions, passages, and storage before and after replay. |
| Historical question backfill | Backfilled questions used template version 2 against a persisted version 1 plan. | Questions use the persisted plan version and research angle. The real backfill followed by normalized claim input succeeds. Existing mismatches are flagged for review without rewriting historical questions. |
| Manual public references | Ordinary HTML references were dispatched to the PDF-only action. | The pinned public metadata inspector selects web or PDF retrieval by normalized response content type. Regressions cover HTML, XHTML, extensionless PDFs, safe redirects, private redirects, unsupported formats, cancellation before DNS, and replay. |
| Exa Contents timeout | The timeout race left paid HTTP requests active while the adapter retried. | Each SDK Contents attempt owns an abortable HTTP transport. The real SDK and action regression observes at most one active attempt, two distinct aborted signals on exhaustion, and independent signals for concurrent sources. HTTP failures, invalid JSON, malformed schemas, and oversized responses have explicit outcomes. |
| PDF fixture registration | OCR limitations were discarded and partial acquisition became success. | Registration preserves unreadable-page metadata. A two-page fixture with one unreadable page returns partial, preserves its readable passage and limitation, and replays without another request. |

The automatic continuation and SDK transport choices are recorded in the 2026-10-19 amendment to ADR-023. Approved Sources retain their existing composition and remain inspectable during extraction, acquisition failure, capability pause, and evidence readiness. New-revision eligibility comes from the server's existing lifecycle rule.

Browser validation also exposed repeated whole-table provider history reads in the dossier projection. That projection now uses the existing run index while preserving the returned failure ordering and filtering.

## Test boundaries

Default tests use fixtures and mock external HTTP or DNS boundaries. The source approval browser fixture invokes the real atomic handoff, then records explicit fixture acquisition failures in the same transaction before the scheduled workflow can reach any provider. It produces no source versions or claims. The separate evidence matrix fixture exercises persisted showcase claims and policy through the real workflow. Neither fixture establishes live provider behavior.

Provenance action tests hold scheduled work with fake timers so the test-driven action and its scheduled workflow do not execute concurrently. Tests that verify orchestration explicitly drain the scheduler. Node action dependencies are loaded before the workflow test environment removes Node globals.

## Verification results

The source candidate is an uncommitted working tree based on `f0c4831`. No production or test source files changed during the final full-suite run. This report was completed afterward.

| Check | Result | Evidence |
| --- | --- | --- |
| Seven backend repair suites, one worker | 88 passed, no failures or runner errors | `/tmp/phase5-fixes/vitest-regressions.log` |
| Frozen-query, identical-action replay, approved-source visibility, and Progress regressions | 11 passed, 22 intentionally unselected | `/tmp/phase5-fixes/vitest-replay-ui.log` |
| Final full suite, repository default four workers | 786 passed, 13 failed across 4 files, no runner errors | `/tmp/phase5-fixes/vitest-final.log` |
| Frontend and Convex TypeScript checks | Passed | `/tmp/phase5-fixes/typecheck-final.log` |
| Repository lint and import checks | Passed, 368 files checked | `/tmp/phase5-fixes/lint-final.log` |
| Formatting of 30 task files | Passed | Installed Biome formatter, read-only check |
| Repository-wide formatting | Failed for 16 files outside this repair scope, left untouched | `/tmp/phase5-fixes/format-check.log` |
| Production build | Passed, client and server bundles | `/tmp/phase5-fixes/build.log` |
| Local Convex bundle push | Passed | `/tmp/phase5-fixes/convex-push.log` |
| Protected desktop approval journey through the application dossier link | 1 passed, server reached extraction failure with zero provider calls, approved Sources retained, revision action disabled, Progress copy checked | `/tmp/phase5-fixes/playwright-approval.log` |
| Desktop and mobile after-change comparison | Five screenshots and assertions passed through normal in-application navigation | `/tmp/phase5-fixes/capture-after.log` |

The final full-suite failures are two landing-route timeouts, nine start-route failures, one evidence-sufficiency route timeout, and the complete durable evidence workflow retry test timeout. Most failures hit the existing 5-second test deadline. Two start-route cases failed missing-element assertions. These outcomes do not establish a root cause, and the full suite is not accepted as green. The durable workflow timeout remains an integration-verification limitation even though the protected approval journey, retrieval regressions, and narrower retry tests pass. No assertion or production timeout was relaxed.

An earlier full-suite attempt during test-harness repairs recorded 784 passed, 15 failed, and 5 runner errors. An earlier ten-file focused run recorded 126 passed, 4 failed, and one runner error. Their logs remain at `/tmp/phase5-fixes/vitest-full.log` and `/tmp/phase5-fixes/vitest-focused.log`. The latter included a transport-timer freeze corrected before the final run. The final full result supersedes neither the existence nor the diagnostic value of those failures.

The initial broader browser run recorded 3 passed and 7 failed. It exposed a dossier-list query timeout and repeated hard-reload workspace-loading failures before approval. The indexed history read was applied, and the repaired approval test now navigates through the existing dossier link. Its independent rerun passed. The complete browser gate was not rerun. Initial results remain at `/tmp/phase5-fixes/playwright.log`, with sanitized traces and error contexts under `/tmp/phase5-fixes/playwright-results`.

Before-change screenshots are `sources-before-desktop.png`, `sources-before-mobile.png`, `approved-before-desktop.png`, and `approved-before-mobile.png` under `/tmp/phase5-fixes`. After-change screenshots are `approved-after-desktop.png`, `approved-after-mobile.png`, `automatic-after-desktop.png`, `automatic-after-mobile.png`, and `progress-after-mobile.png` in the same directory. The legacy approved mobile view was visually compared with its baseline. The automatic desktop view retained the established navigation, source grouping, cards, and read-only banner. Browser checks used installed system Chrome against the existing local services, without restarting them. These artifacts are local and are not committed.

The 88-test backend gate ran the real modules in `web-pdf-provenance-tracer`, `exa-contents-adapter`, `exa-contents-transport`, `phase-5-authority-backfill`, `phase-5-start`, `phase-4-workflow`, and `source-review-fixture`. The additional 11-test gate selected the frozen-query, identical-action replay, approved-source visibility, and persisted preparation-state cases from `sec-provenance-tracer` and `run-route-component`. Both used `node node_modules/vitest/vitest.mjs run` with `--maxWorkers=1 --silent`. The full gate used `pnpm test --reporter=dot`.

Live SEC and Exa contract tests were not run. The report establishes deterministic behavior and local application integration, not live provider availability or model extraction for new dossiers. Existing incorrectly backfilled questions are flagged for operator review and were not rewritten.

## Operational boundary

Only the existing local Convex deployment `local-aboul_panga-dd_proto` and Vite service were used. No cloud deployment, live provider contract call, historical-data repair, dependency change, commit, or publication was performed. The temporary browser fixture flag was confirmed disabled after teardown. Browser admission material was read from the ignored local configuration file and is excluded from verification artifacts.

A setup diagnostic mistakenly printed local configuration secrets in the conversation's tool output, including provider credentials, signing material, and invitation material. No secret values were copied into repository files or verification artifacts. Credential rotation was not performed.
