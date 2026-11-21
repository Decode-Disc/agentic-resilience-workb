# Documentary qualification replacement — 2026-11-21

## Decision

The approved replacement reached actual Start and completed Sources preparation using the capture acquired during framing. This is positive live evidence for capture transfer, explicit qualification, control and terminal Sources handoff. It is not complete acceptance: Workbench published two material inaccuracies in the first case, contextual continuation after saving was not demonstrated, and an evaluator assertion prevented the planned Workbench consultation after Sources completed.

The replacement used 38 confirmed model/control calls at USD 0.08386602200000001. Together with the [preceding evaluator rerun](2026-11-21-documentary-evaluator-rerun.md), cumulative consumption is 58 calls and approximately USD 0.10264, below the original 80-call/USD 1 envelope. Both lots are closed and reconciled. No external documentary search or acquisition was dispatched, and no additional correction or paid repetition followed this replacement.

## Candidate and execution

The worktree was `/home/abdwhb/.herdr/worktrees/agentic-resilience-workbench-proto/refactor-documentary-engine`, branch `refactor/documentary-engine`, base `2816370980accf0155c09d62054ca83511ca43d3`. Candidate hash: `7cd02bb17fb7637d4404277ace3d48f5370e9c31c452c6fe3851a8957cafcb7f`. Battery hash: `bca4c806373bf51a3f8f0d16ef5992aa3d2904939105f1a74b5558979ebd5881`.

The user approved the same two NVIDIA cases with at most 60 further calls and USD 0.98, without external documentary retrieval, another correction or another repetition. `SOURCES_PREPARATION_WINDOW_MINUTES=30` was temporarily provided from the already approved research duration. Global Sources activation remained disabled. Actual serialized requests used `z-ai/glm-5.3-flash`, high reasoning and OpenRouter-managed routing, with canonical `max_price` prompt 0.15/completion 0.6 and no upstream pin.

The first preparation attempt passed all checks but stopped before lot admission. Subsequent inspection found no managed backend/web processes or listeners; the cause of their disappearance remains unknown. The existing `pnpm dev` service was restored at the same worktree-specific ports (3238/3239/5187). The watcher confirmed functions ready, offline model preparation succeeded, and the candidate hash was unchanged. The same authorized campaign then admitted its only lot; this recovery did not consume an additional lot or make inference calls.

Automated scenarios ran from `2026-11-21T13:09:13.545Z` through `2026-11-21T13:22:05.203Z`, approximately 12 minutes 52 seconds. Preflight, local-runtime recovery and investigation were separate. No browser was used.

## Observed capability boundaries

| Boundary | Observation |
| --- | --- |
| Acquisition and reading | One metadata-only acquisition per dossier. The first performed twelve successful 6,000-character context reads, including five consecutive beginning pages covering offsets 0–30000. No complete filing was automatically returned. |
| Actual serialized inputs | All 38 retained model/control request payloads passed SHA-256 verification. Maximum measured bodies were 277,155 bytes and 306,372 bytes, both smaller than the 370,281-character complete normalized document. They include accumulated requested history, not a fixed context-size promise. |
| Saving and reuse | First framing reached revision 3. After a new message, old references were refused; search and reading resumed under fresh authority without reacquisition. The second framing searched the same document reference after saving but did not invoke contextual continuation. Exact next-reference reading after a save therefore remains unqualified by this lot. |
| Actual Start | Fixed the second dossier's agent-saved revision 2. All seven questions were copied exactly into Sources needs, with the common scope as an eighth need and the correct default `balanced` coverage. |
| Capture transfer | The same capture ID and content hash appear in acquisition, the initial serialized Sources inventory, qualification and terminal handoff. The initial inventory had no later qualification-task identifier: qualification was explicit after Start. |
| Sources qualification and completion | Sources 7 made nine generations and one documentary control after six Workbench generations. It qualified the exact capture, retained twelve controlled contributions with permitted-use restrictions, and completed its mission/preparation into `sources_prepared`. The handoff distinguishes reported figures, attributed company arguments, context and unresolved causation. This is documentary preparation, not independent acceptance of economic conclusions. |
| Post-Start conversation | Not exercised: the evaluator failed before sending the declared message. |

The first dossier used 22 calls at USD 0.05664272099999998; the second used 16 calls at approximately USD 0.027223301. Sources searched exact excerpts without `read_in_context`, which the pinned policy permits when contextual reading is not mandatory.

## Published-answer failures

The first published answer says all five saved questions cite the read passages. Its successful save receipt instead associates citations with q1, q2, q4 and q5; q3 has no association. Publication bodies reconstructed from mission results match the delivered-message hashes. This is a false saved-state claim despite a correct structured receipt, so the truthful-publication check failed.

The same answer calls USD 130.1 billion and 57% growth Compute & Networking revenue. The filing's corresponding table is operating income: USD 130,141 million versus USD 82,875 million. The exact search excerpt begins after the table title and is immediately followed by revenue commentary; the complete captured filing preserves the title. Missing excerpt context and the published metric confusion are both verified. Their causal weight is not established; this lot does not prove that mandatory context reading or a different excerpt would correct the answer. The saved q3 wording does not reproduce the incorrect USD 130.1 billion revenue figure. Semantic response control was disabled in the retained application configuration; these failures do not measure the behavior of an enabled response controller.

Two rejected framing proposals were corrected before successful saves; two stale-reference reads were refused before fresh search recovery. Those refusals preserved state. They do not erase the later published inaccuracies.

## Evaluator failure after successful Sources completion

At [scenarios.ts](../../scripts/evaluations/workbench-browser/scenarios.ts), the `sources_prepared` handoff check compares the resolved `sources.coveragePolicy.preset` directly with optional `scenario.coveragePreset`. Both approved scenarios omit that field. The existing [seed owner](../../convex/e2eFixtures.ts) applies `recordedScenario?.coveragePreset ?? "balanced"`, so the assertion compares `balanced` with `undefined` and fails. The snapshot immediately before failure shows preparation `complete`, mission `completed`, run `sources_prepared`/`idle`, one qualification and the preserved capture.

A read-only recheck of the remaining handoff assertions confirmed the fixed revision, every question's exact copied text and the included common scope. The later conversation step was never submitted. No code was changed to repair this additional evaluator defect because the replacement authorization excluded further correction and repetition. The official execution failure remains preserved; manual assessment separates it from the completed Sources behavior.

## Validation, closure and evidence

Preflight passed 231 protocol tests, 235 domain tests across 19 files, types, lint, import and execution-ownership checks on the frozen candidate. The earlier evaluator correction's focused 40-test and 46-protocol-test evidence remains in its report. No application build or UI qualification was performed.

Manual assessment `5f5a58c487587c686bce06d44684d563a85be3e697a8b67ace283ce0a823a85a` was accepted with a failed verdict and separate passed/inconclusive checks. The campaign is closed, its lot finished, context revoked, cleanup complete and all receipts reconciled. Temporary credentials, fixture activation, private invitation input and the preparation-window setting were restored to their prior absence. The restarted development services remain running. No dependencies, application code, commits or pushes were changed during the replacement.

Native byte-preserved evidence: [execution archive](../../scripts/evaluations/archives/20261121T132223495Z-campaign-documentary-operations-window-ready-20261121-lot-1/record.json) and [assessment archive](../../scripts/evaluations/archives/20261121T132532163Z-campaign-documentary-operations-window-ready-20261121-lot-1-asse/record.json). The [verified supplemental closeout archive](../../scripts/evaluations/archives/20261121T132821486Z-documentary-window-ready-closeout/record.json) retains measurements, manual handoff checks, runtime recovery observations, publication hashes and teardown evidence (18 files, 818,237 bytes).

## Subsequent diagnosis and evaluator correction

The later [citation-count diagnosis and evaluator correction](2026-11-21-citation-count-publication-diagnosis.md) confirms the publication mechanism and fixes the coverage assertion with deterministic regressions and a frozen replay. No new paid lot was run; the original results, failed assessment and unexercised live post-Start conversation remain unchanged.
