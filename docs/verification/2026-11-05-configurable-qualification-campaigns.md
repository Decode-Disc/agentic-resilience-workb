# Configurable qualification campaigns — 2026-11-05

Version 2 lets the development agent supply an external scenario/configuration manifest and execute evaluation lots within one bounded mandate. Company identities, framing, ordered actions, per-role model/effort profiles, expectations, shared lot budgets and optional scenario caps are data. The development agent remains the evaluator. Version-1 records and grants retain their historical behavior.

## Delivered boundary

The [campaign schema](../../convex/qualificationCampaignPolicy.ts) owns input validation. The existing runner resolves omitted scenarios from the default batteries, freezes the resolved content, selects a declared configuration and creates fresh dossiers. The finite interpreter accepts domain actions rather than caller-provided code or selectors. The backend validates scenario-to-dossier CIK bindings, reserves the whole lot, enforces context/scenario usage atomically with provider receipts, and updates that projection during late billing and discovery settlement. Cursor-based inspection replaces sample-dependent audit ceilings. Successful coverage is keyed by both candidate and configuration; all configurations must pass the current candidate.

The [technical contract](../../context/TECH.md#access-resources-and-security) owns the durable behavior. Its legacy paragraphs now explicitly describe historical grants; the new version-2 passages describe the replacement. The evaluation skill contains the corresponding invocation procedure. Product requirements and the application interface were not changed.

## Protected runtime evidence

The Sources campaign used three arbitrary identifiers (`claims`, `creative`, `platform`), three labelled simulation companies, two configuration identifiers, different ordered paths, desktop/mobile viewports, pause/resume, navigation, reload and conversational follow-up. It used real anonymous invitation admission and the existing local Convex backend and native workers. All external Sources responses and generation were simulated.

| Lot | Candidate | Configuration | Result |
| --- | --- | --- | --- |
| Earlier 1 | `5d2d98a9cd54e54b0a40c8aeb41840c4c53c9b89706f60b668ffdef0e9380988` | first | Failed; retained unchanged. |
| Earlier 2 | `5ea4668eaf675d3b3d2fee9403434104464555838dcf759d0fa85d80a712ca61` | first | All three scenarios passed on the first corrected candidate. |
| Earlier 3 | Same first corrected candidate | second | All three scenarios passed; selected automatically after assessment of lot 2. |
| Final 1 | `90126a99f0c555e3946c5817d53e11d074dc8d3a1edb54e59bb3054ed272b357` | first | All three scenarios passed on the current code. |
| Final 2 | Same final candidate | second | All three scenarios passed; automatically selected and assessed under the same mandate. |

Each of the six final matrix dossiers retained one conversation across its ordered steps, one committed hash-checked capture, six adopted documentary operations and an explicit partial handoff. Every retained mission completed with simulation provenance; documentary tasks remained labelled showcase work. No provider receipt was created. The Motion warning from explicitly reduced-motion browser contexts was expected; no browser console error was recorded. The six final scenarios establish orchestration and evidence mechanics, not a comparison of real model quality.

The first lot demonstrated a runner defect after reload: an immediate visibility check selected the mobile “Ask AI” entry before the desktop composer hydrated. The handoff was already persisted, and the later failure screenshot showed the desktop composer. The runner now waits for either supported entry before selecting it. Both configurations on that corrected candidate passed the previously failing reload/dialogue path. The first failed lot remains separate from their results; its third scenario was not executed.

A separate Workbench path exposed an incorrect stop-button accessible name in the interpreter. Its failed lot released publication during cleanup. After matching the existing component's “Stop generation” label, the protected path passed cancellation before provider admission, reload, timeline/framing navigation, mobile reconnection and a subsequent message in the same conversation. Research stayed unstarted and provider receipts remained empty. This path is retained under `/home/abdwhb/.local/share/agentic-resilience-workbench/qualification-v2-workbench-stop-20261105-corrected` on candidate `a78f8f98677118757cf6b928a371fc4101bfaa4d4e3b18d270549057648b8519`.

A final cleanup correction removes the host's legacy 25-page ceiling. The backend already closes/revokes the context and pages owned dossiers; the host now follows all pages and rejects a stalled cursor. The final Sources matrix passed both configurations under `/home/abdwhb/.local/share/agentic-resilience-workbench/qualification-v2-20261105-release` on candidate `90126a99f0c555e3946c5817d53e11d074dc8d3a1edb54e59bb3054ed272b357`. Its two lots were assessed passed on the same current candidate and the campaign was closed.

## Deterministic checks

The final candidate passed the native runner preflight: `pnpm typecheck`, 51 Node protocol/relay/campaign tests, 92 Convex tests, scoped Biome checks, import checks and execution-ownership checks. Exact command definitions are preserved in each lot's `code/scripts/evaluations/workbench-browser/protocol.ts`; their output is retained in `checks/*.log`.

`pnpm exec vitest run src/__tests__/convex/integrations/provider-billing.test.ts src/__tests__/convex/integrations/provider-calls.test.ts --maxWorkers=1` passed 26 additional tests. A focused `pnpm exec biome check` of all 30 task files passed without warnings. `pnpm docs:check` validates the final reference/report links; its TECH word-count warning is advisory. The application build and full `pnpm check` aggregate were not run for this tooling/local-fixture change.

Regression evidence covers matrix coverage after a correction, unknown configuration rejection, three-dossier grants above legacy limits, 60 admitted mocked-boundary model attempts followed by refusal at the shared ceiling, optional per-case caps, replay accounting, late billing/unknown-outcome fencing, and complete inspection of 135 receipts. The relay accepted 24 mocked upstream calls with a different frozen route and refused the next call. Cleanup continued through 27 mocked backend pages and refused a non-advancing cursor. These are deterministic fixtures, not provider calls.

A shared-model regression first failed because two roles could not select different efforts from one catalogue default. Workbench now uses the existing initial per-conversation model selection while Sources keeps the temporary catalogue default. A second regression exposed two default mutations whose increasing revisions could not be restored by the existing concurrency fence. Configuration now changes that shared default once. Both grant and restoration regressions pass; native input preparation already covers supported effort choices.

## Teardown, authority and limits

The Sources campaign is closed, both final configurations are passed, and no lot awaits review. Reconciled consumption is zero model/search/acquisition calls and USD0. Temporary fixture and Workbench flags are off, Sources remains globally disabled, publication is released and no worker is active. The original backend and web processes were preserved (PIDs 75259 and 78942). The watcher applied the latest backend functions successfully; no second backend, cloud deployment, dependency change, commit or paid execution was performed.

Existing prepared-route/model policy, workflow/input limits, Sources execution windows and finite local contexts still apply. Transport-fault configurations are limited to their supported live Workbench relay; no paid/live fault-injection or real-provider quality qualification was performed. The existing partial-result interface label and canned-answer limitations remain separate from this campaign mechanism. A real-provider evaluation requires a mandate covering its actual routes and spending; this implementation does not activate one.

## Retained evidence

Final Sources input, immutable lot evidence, reviews, `matrix-review.json` and `final-state.json` are under `/home/abdwhb/.local/share/agentic-resilience-workbench/qualification-v2-20261105-release`. Earlier Sources stages remain under `/home/abdwhb/.local/share/agentic-resilience-workbench/qualification-v2-20261105-final`. The matrix review independently checks both final candidate identities, scenario CIKs, conversation continuity, capture bytes, task provenance and absence of provider receipts.

Verified native archive records retain the [failed lot](../../scripts/evaluations/archives/20261105T193836373Z-campaign-configurable-local-matrix-final-lot-1/record.json), [final first configuration and judgment](../../scripts/evaluations/archives/20261105T195156512Z-campaign-configurable-local-matrix-final-lot-2-assessment/record.json), and [final second configuration and judgment](../../scripts/evaluations/archives/20261105T195752255Z-campaign-configurable-local-matrix-final-lot-3-assessment/record.json). The [current first profile](../../scripts/evaluations/archives/20261105T201403198Z-campaign-v2-release-matrix-lot-1-assessment/record.json), [current second profile](../../scripts/evaluations/archives/20261105T201737300Z-campaign-v2-release-matrix-lot-2-assessment/record.json), [failed stop probe](../../scripts/evaluations/archives/20261105T200422684Z-campaign-v2-workbench-stop-lot-1-assessment/record.json) and [corrected stop probe](../../scripts/evaluations/archives/20261105T200642478Z-campaign-v2-workbench-stop-corrected-lot-1-assessment/record.json) are archived separately. Consolidated archival status is appended after verification. All archives are local byte-preservation evidence, not semantic acceptance or off-machine backup.

The [consolidated archive](../../scripts/evaluations/archives/20261105T202221619Z-configurable-campaigns-v2-final/record.json) is verified: 11,896 files and 155,295,804 uncompressed bytes, including protocols, captures, candidate snapshots, failed/corrected stages, judgments, deterministic diagnostics and current reference documents. It captured this report body before this archive-metadata append. The archive is local-only and its verification establishes byte preservation.
