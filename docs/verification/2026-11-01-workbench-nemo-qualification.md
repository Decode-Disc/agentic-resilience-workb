# Workbench Mistral Nemo qualification — 2026-11-01

## Decision and boundary

Do not qualify or activate `mistralai/mistral-nemo` through `io-net/fp16` with the tested native Workbench configuration. Nineteen paid calls across ten predefined scenarios produced no accepted conversational completion: eight scenarios ended with plain-text responses rejected by the required completion schema; two exhausted their individual call allowances before a final response. Several domain tools worked, but formatting, task selection and state interpretation prevent a useful analyst journey. This does not establish that other routes or configurations would fail.

The user authorized this route with a maximum of twenty physical calls and no application activation. Inference used live OpenRouter HTTP; the existing Pi adapter, mission continuation and domain operations ran against isolated `convex-test` state. No live source acquisition, deployed dossier, browser journey or external research workflow was exercised. The implementing assistant authored the expectations before dispatch and reviewed the outputs; these familiar fixtures are not held-out robustness evidence or independent semantic acceptance.

## Conditions and accounting

The experiment retained fixed CCC company-only/activity requests, existing-draft refinements, an overlapping analyst edit, Start research authority, explicit pause/resume, ambiguous control, a deferred documentary request and a saved-material reading. Running and reading fixtures use ServiceNow. The evaluation loader replaced the candidate route and omitted unsupported reasoning settings in memory; it did not edit application routing, profiles or deployment environment. Production source hashes were checked before every dispatch. Relevant uncommitted source bytes were retained because Git HEAD alone does not identify this candidate.

The provider route was fixed with fallback disabled, temperature zero, at most 6,144 output tokens and 131,072 request bytes, a sixty-second timeout, zero retries and a conservative cumulative reservation ceiling of $0.50. The transport permitted only OpenRouter chat-completion POSTs. Route availability and prices were captured before dispatch from the [official endpoint catalog](https://openrouter.ai/api/v1/models/mistralai/mistral-nemo/endpoints).

| Observation | Result |
| --- | --- |
| Physical dispatches / received responses | 19 / 19, all HTTP 200 |
| Unknown external outcomes | 0 |
| Prompt / completion tokens | 67,576 / 2,280 |
| Cached prompt tokens | 40,432 |
| Catalog prices, USD per million | Input 0.01656; cached input 0.0108; output 0.0216 |
| Provider-reported charge | $0.00093541824 |
| Recomputed charge using cached and uncached usage | $0.00093541824 |
| Conservative cumulative reservation | $0.12855735, distinct from actual charge |
| Response latency, minimum / median / maximum | 602 / 3,594 / 6,968 ms |

The remaining authorized call was unnecessary after the fixed cases completed. No retry, fallback or additional candidate was dispatched. Prices and availability are a dated observation, not a permanent routing contract.

## Scenario findings

| Scenario | Calls | Observed result |
| --- | --- | --- |
| Company-only framing | 2 | Saved five mostly generic company-wide questions. The scope remained the company name; the control question presupposed control instead of proposing a useful activity to investigate. Final prose failed the completion schema. |
| Supplied photo-led claims activity | 2 | Saved questions mentioning the activity, but retained a company-wide scope and generic workflow language. Final prose pointed to Start research, then failed the schema. |
| Targeted refinement | 2 | Invented expected revision 2 while the supplied draft was revision 1. The server rejected the edit; the requested refinement was not saved. Final prose failed the schema. |
| Concurrent analyst edit | 3 | The analyst's newer scope and switching question survived. The model failed to supply the observed revision and did not recover after the conflict. Final prose failed the schema. |
| Start research authority | 1 | Attempted an unrelated framing edit, refused for revision conflict. Research stayed unstarted. A second inference was prevented before network I/O by the case allowance; the expected guidance was not produced. |
| Explicit pause | 2 | Correctly registered a pause request. Research remained running with pause requested; raw final prose incorrectly claimed effective suspension and also failed the schema. That prose was not published. |
| Explicit resume | 2 | Correctly invoked resume, moving the isolated run from paused generation 3 to running generation 4. Raw final prose described the resumed state but failed the schema, so conversational completion remained unverified. |
| Ambiguous control | 1 | Did not pause or resume. Attempted an unrelated framing edit, rejected because framing was fixed. A second inference was blocked before network I/O by the case allowance; no clarification was delivered. |
| Deferred documentary request | 2 | Tried to change fixed framing instead of transmitting the documentary request. No tracked instruction was created. Final prose reported fixed framing and failed the schema. |
| Saved-material reading | 2 | Called `read_in_context` with an unverified passage index, received `passage_unavailable` and did not search or recover. No passage-backed explanation was produced; final prose failed the schema. This does not establish failed reading of an available indexed passage. |

The completion failure is directly reproducible from the retained requests and responses: the system explicitly requests `{"kind":"complete","text":"..."}`, while every final response is unwrapped prose. `convex/execution/invokeAgentModel.ts` parses and validates the completion and blocks invalid output. Successful tool calls are separate from conversational completion and do not establish analytical usefulness.

The two allowance-limited cases appear as `attempt_outcome_unknown` in the mission state because the evaluation wrapper refused a subsequent inference. Their transport journal proves that those extra requests were never dispatched; they are incomplete scenarios, not unknown provider charges. Mission records captured after cleanup are cancelled; interpretation uses `stateBeforeCleanup` and the raw request/response journal rather than treating cleanup cancellation as the original result.

## Verification and retained evidence

The final unpaid preflight exercised all ten scenarios with eleven simulated transport responses. The real input-capacity calibration passed three tests. The live Vitest driver recorded all ten scenarios in 78.07 seconds; its passing assertions check case call limits and recording, not model quality. Offline `review-live.mjs` additionally verified the nineteen request/response pairs, fixed route and disabled fallback, per-case allowances, absence of unknown charges, zero valid completions and exact cost reconciliation. Raw unsuccessful preflights and the calibration artifact are preserved alongside the live run. `pnpm docs:check` passed with 95 Markdown files, 504 local links and zero errors; the existing technical-reference word-limit warning is advisory. `git diff --check` passed.

Commands used for the live lot and journal validation:

```sh
WORKBENCH_PAID_QUALIFICATION=20261101_20 pnpm exec vitest run --config /tmp/start-workbench-review-20261101/paid/qualify.config.ts
node /tmp/workbench-paid-qualification-20261101/review-live.mjs
```

The [verified pre-dispatch code archive](../../scripts/evaluations/archives/20261101T085747402Z-workbench-nemo-code/record.json) retains 334 files, including actual backend source, relevant fixtures, package/lock/configuration files, protocol, catalog captures, candidate overlay and calibration inputs. The [verified post-run archive](../../scripts/evaluations/archives/20261101T090232166Z-workbench-nemo-results/record.json) retains 243 files: live requests, raw SSE replies, cost journal, input/domain snapshots, review, unsuccessful preflights, driver, this report and its related roadmap entry. The final post-run record link was added after archive creation; it does not alter the archived findings. Archives are verified local storage only, with no off-machine backup claim. No credentials or environment files are included.

No application activation, dependency change, production code change, deployment synchronization or fresh browser acceptance is part of this qualification. The existing deterministic and protected browser checks remain separate evidence. The next useful boundary is to resolve completion compatibility and misleading state interpretation before another bounded live qualification; this report authorizes no further paid calls.
