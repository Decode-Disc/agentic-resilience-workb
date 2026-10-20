# Source recovery and live retrieval contract repairs

Date: 2026-10-20. Candidate: working tree based on `f3c0080`. This verification follows the failed provider contracts and incomplete browser coverage recorded in `2026-10-19-source-discovery-recovery.md`. Historical failures remain evidence of the earlier candidate.

## Changes and causes

Metadata discovery sent `contents: false` directly to the Exa HTTP API. That option belongs to the SDK interface. The production HTTP transport now omits the field. Contents retrieval also exceeded the documented text maximum by sending 4,194,304 characters and an unsupported legacy option. The production adapter now caps text at 1,000,000 characters, preserves smaller caller limits and application byte bounds, and omits the unsupported option. Cancellation and bounded retries remain in place. The contract was checked against the official [Contents reference](https://exa.ai/docs/reference/get-contents) and [API schema](https://exa.ai/docs/exa-spec.json).

The SEC live contract used a nonexistent filing accession, producing HTTP 404. Official submissions for stable CIK `1818201` identify the annual report filed on 2024-02-28 as accession `0000950170-24-022253`, primary document `cccs-20231231.htm`. The live fixture now uses that verified identity. Synthetic offline fixture identities remain separate. No SEC production retrieval change was needed.

Successful access admission closed the drawer twice. The second close invoked the cancellation callback after successful navigation, replacing the requested Dossiers destination with Start. Successful closure is now owned by the admission provider. Explicit cancellation still invokes its callback once. The existing browser-test helper no longer encodes the incorrect Start destination.

Recovery feedback now stays beside the action, includes visible pending and terminal states, distinguishes rejected requests from availability failures, and disables retry during the persisted cooldown with a countdown. A coverage search keeps its popover open. A resolved coverage requirement retains the result in the summary when its control disappears. The inspector uses the existing source cards for matching candidates instead of repeating raw titles as buttons inside a blue alert. Empty matches are distinguished from an empty dossier. Source decisions, approval, Add source link, and mobile Source actions remain available.

## Regression evidence

The focused tests import real production modules and mock external HTTP, clocks, or the reference-routed Convex React boundary. RED probes reproduced the malformed metadata request, excessive Contents request options, cancellation after successful admission, conflation of HTTP 400/401 with retryable outages, missing action-local feedback, missing cooldown countdown, duplicate inspector presentation, misleading empty matches, and loss of feedback when a coverage control disappears. Each corresponding focused regression subsequently passed. Setup errors and exploratory timeouts are retained separately and are not presented as behavioral RED evidence.

Logs are under `/tmp/workbench-recovery-fixes`, including `search-contract-red.log`, `contents-contract-red.log`, `admission-red.log`, `rejected-reason-red.log`, `feedback-ui-red.log`, `live-feedback-red.log`, `coverage-ui-red.log`, `empty-matches-red.log`, `inspector-title-red.log`, and `resolved-feedback-red.log`. The corresponding green logs preserve the focused results. The backend recovery suite passed all 28 cases after updating obsolete wire-format expectations. The two source-review component files passed 38 cases before the final resolved-control regression, whose final focused pair also passed. The final full suite below is authoritative for the complete candidate.

## Live provider runs

The retrieval command was `RUN_LIVE_PROVIDER_TESTS=1 TMPDIR=/tmp TEMP=/tmp TMP=/tmp node --env-file=.env.local node_modules/vitest/vitest.mjs run src/__tests__/live/sec-evidence-retrieval.contract.test.ts src/__tests__/live/exa-contents.contract.test.ts --maxWorkers=1 --reporter=verbose`. Both contracts passed. Evidence: `live-retrieval-contracts.log`.

| Contract | Observed result |
| --- | --- |
| SEC approved filing | One HTTP request, 879 ms, 556,064 bytes, 512 passages, exact locator reproduction, succeeded |
| Exa Contents approved page | One SDK call, 430 ms, 5,461 bytes, 34 passages, exact locator reproduction, succeeded, reported cost $0.001 |

The added metadata search contract is a scripted file at `src/__tests__/live/exa-discovery.contract.test.ts`. Its opt-in command uses the same environment and Vitest arguments with that path alone. It passed after one production transport call, returning one bounded metadata candidate in 1,951 ms. Evidence: `live-discovery-contract.log`. All three contracts return before provider construction or credential access when the opt-in flag is absent. The full deterministic suite explicitly sets it to `0`.

## Browser verification

Verification used `agent-browser` session `recovery-fixes-82b3b610d06f`, real anonymous authentication, and normal access-code admission on the existing local services. No Playwright E2E runner was used. The separate test analyst slot was used throughout. The user's analyst slot and original ServiceNow dossier were not mutated.

The baseline reproduced admission to Dossiers being replaced by Start. After the fix, a fresh admission stayed at `/workspace/dossiers`. A new real ServiceNow run, resolved through stable CIK `1373715`, was launched through the normal company, preset, and confirmation UI. Its research angle explicitly labels browser verification. Initial discovery produced 21 candidates with no failed-search warning. A targeted integration-documentation search visibly entered a disabled pending state, remained on the dossier, completed on its first attempt, added one new candidate, and produced proposal version 2 with 22 total candidates. The final persisted run remained paused at source review with a draft corpus and no failed discovery families. Recovery did not approve the corpus or extract document bodies.

The real run is `k9715gt51yc5xccn9yww8sd0y58gmtm0`. Bounded local telemetry recorded four initial discovery calls and one recovery call, all successful on their first attempt, each reporting $0.007. The measured total for those five calls is $0.035. This does not include an unreported cost for the standalone metadata contract. Evidence: `live-browser-telemetry.json` and `live-browser-final-state.json`.

Desktop 1440×1000 and mobile 390×844 checks covered compact coverage context, matching and empty candidate states, pending and completed feedback, mobile Add source link, keyboard opening and Escape focus return, reduced motion, reconnection, and horizontal overflow. A separate guarded capacity fixture verified visible failure feedback without provider I/O. The final clean browser pass had zero page errors, console errors, warnings, and horizontal overflow. Earlier hot-reload errors during the export rename and expected Motion development warnings during reduced-motion checks remain in `browser-console.log`; final evidence is in `browser-final-console.log` and `browser-final-errors.log`.

Before and after screenshots, live search feedback, and final inspector captures are retained in the evidence directory. The final inspector context row measured 65 pixels high at desktop width. The temporary local fixture flag was removed and its absence verified. The named browser session was closed. Existing development services were left running.

## Final checks

| Command or gate | Result | Evidence |
| --- | --- | --- |
| `RUN_LIVE_PROVIDER_TESTS=0 pnpm test --maxWorkers=2 --reporter=dot` | 846 tests passed across 117 files, no runner errors | `full-suite.log` |
| `pnpm typecheck` | Client and Convex passed | `typecheck.log` |
| `pnpm build` | Client and server production builds passed | `build.log` |
| `pnpm check` | Both typechecks passed, then stopped at the unchanged array-index-key lint error in `src/components/workbench-shell/analyzed-company-list.tsx:114` | `check.log` |
| Focused Biome lint and formatting | All 22 checked task files passed | `lint-task.log`, `format-task-final.log` |
| Import checks and `git diff --check` | Passed | Direct final commands |
| Repository-wide formatting | 22 unchanged files still have diagnostics, with no overlap against modified files | `format-full.json` |

The task source/test fingerprint in `candidate-hashes.json` was unchanged during the full suite and build. The suite emitted existing negative-case error-boundary diagnostics, workflow status reports, and a Motion reduced-motion development warning. The cached pnpm binary also emitted its embedded Node 20 engine warning; the child Node executable was verified as v24.18.0. These diagnostics are retained in the logs.

The full retrieval benchmark, Firecrawl, real Unstructured, model providers, and Playwright E2E suites were not run. The browser test dossier remains at source review, so no claim-generation or whole-MVP acceptance is asserted. No cloud deployment, dependency change, credential rotation, commit, or publication is part of this repair. The next product slice remains Phase 6 dimension review, with the earlier roadmap retrieval certification item now supported by successful real SEC and Exa runs.
