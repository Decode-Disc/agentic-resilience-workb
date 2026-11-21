# Documentary evaluator correction and paid rerun — 2026-11-21

## Result

The corrected evaluator reached real model execution. The single authorized lot used 20 confirmed model calls at USD 0.01877379680000002, with zero external documentary searches or acquisitions, no unknown receipts and completed cleanup. Its official verdict is failed: the first scenario completed its scripted operations, but exact continuation after saving remained inconclusive; the second finished framing and then failed at Start because the local deployment lacked its required preparation-window setting. Sources qualification, its capture handoff and post-Start Workbench consultation were not exercised.

This is partial live evidence for the shared documentary engine, not acceptance of all corrected operations. Both cases use previously captured NVIDIA material; they do not establish retrieval quality or general model reliability. The prior zero-call result remains preserved in [the earlier report](2026-11-21-documentary-operations-qualification.md).

## Evaluator corrections

[Model preparation](../../scripts/evaluations/workbench-browser/model-preparation.ts) now calls the existing bounded profile-refresh owner even when the catalogue reports global compatibility. That flag did not establish coverage of the exact current native binding. Existing cached entries are reused; model revisions, role assignments and price policy are checked for concurrent changes. No inference is needed to prepare profiles.

[Scenario observation](../../scripts/evaluations/workbench-browser/scenarios.ts) now reports a paused queue's admission failure before waiting for native settlement. Previously it recognized blocked missions only after a turn existed, so a refusal before turn creation could leave the evaluator waiting until expiry.

After the paid rerun exposed another missing prerequisite, [campaign preflight](../../scripts/evaluations/workbench-browser/campaign.ts) was extended to require the presence of `SOURCES_PREPARATION_WINDOW_MINUTES` for live scenarios that Start research. This last correction was tested locally after the lot and has not itself undergone another paid run. It checks presence, not every possible malformed deployment setting.

## Live documentary observations

The first dossier acquired the complete filing once. Acquisition returned metadata and a reading reference, without documentary text. Search returned exact excerpts. Five successful contextual reads each displayed 6,000 characters from the same 370,281-character normalized capture, including the beginning on explicit request. The complete 370,393-character replay representation was absent from all 14 hash-verified serialized requests. Request bodies still include accumulated authorized history: the largest measured serialized body was 186,223 bytes, not a claim of a fixed context size.

Before its first save, the model opened a search match and its `nextReference`. It saved framing revision 2 with a public conditional citation for question 4. On the following analyst message, an old-turn continuation was correctly refused as `framing_observation_stale`. The model recovered through the newly authorized capture reference, searched and read another passage without downloading the document again, and saved revision 3. This proves reuse after saving and authority renewal across messages; it does not prove uninterrupted continuation from the prior position after saving. The later explicit beginning read preserved revision 3, its five questions and the conditional citation.

Published answer texts reconstructed from mission results matched the SHA-256 of their delivered assistant-message records. The reported revision and conditional citation agree with persisted state. One answer-quality limitation remains: the beginning-read answer interpreted XBRL member names as certifying officers and signature dates, beyond what those member strings alone establish. Reading and preservation checks are separate from that unsupported interpretation.

The second dossier acquired once, searched, saved revision 2, searched again using the same issued document reference and saved revision 3. Search authority therefore survived a save in the same message and mission. However, it did not invoke `read_in_context` or `nextReference`; the exact contextual continuation requested by the scenario remains unexercised. Direct search-result citations were permitted by the pinned server policy, whose contextual-reading obligation was disabled.

## Start failure: confirmed cause

The retained browser context contained both declared scenario bindings, both Sources lot run IDs and the finite paid grant. The runtime did not lack Sources qualification authority. The local deployment had no `SOURCES_PREPARATION_WINDOW_MINUTES`. `researchStartBlock` calls `researchQuestionCapacity`, which calls `sourcePreparationWindowMs()` before using the qualification envelope; missing configuration returns `sources_configuration_unavailable`. The same diagnostic can therefore occur before the envelope check in `framing.startResearch`.

A real Convex integration check reproduced this with a valid Sources qualification grant: remove only the deployment-window input, observe Start refusal with framing still idle and no provider receipts, restore the configured input, and observe Start succeed with its Sources envelope persisted. No model or external retrieval call was made by this isolation check. Global `SOURCES_MISSION_ENABLED` remains disabled; enabling it is unnecessary for this local qualification route.

## Validation and execution boundary

The two initial defects were reproduced RED before implementation: the profile integration still refused current-binding admission after preparation, and scenario observation reported expiry instead of the saved admission refusal. The additional preflight regression also failed RED when the preparation-window name was missing, because the evaluator proceeded to temporary configuration instead of refusing before admission. GREEN then passed through the actual preparation/observation/preflight owners.

Final focused validation passed 40 tests across four Vitest files and 46 Node protocol tests, with no skipped tests in those runs. Typechecking, scoped Biome, import checks and task-path whitespace checks passed. The paid runner's frozen candidate additionally passed 231 protocol tests and 234 domain tests across 19 files, plus its types, lint, import and execution-ownership checks. No browser or application build was run for these evaluator changes.

The paid candidate was `810c26f8e62f40943d825c439a9c495e4aab16b077356cc43a98fc4190670b6c`, on branch `refactor/documentary-engine`, base `2816370980accf0155c09d62054ca83511ca43d3`, in `/home/abdwhb/.herdr/worktrees/agentic-resilience-workbench-proto/refactor-documentary-engine`. The battery hash was `bca4c806373bf51a3f8f0d16ef5992aa3d2904939105f1a74b5558979ebd5881`. The model was `z-ai/glm-5.3-flash`, recommended reasoning resolved and serialized as high. Actual requests retained OpenRouter-managed routing with `max_price` prompt 0.15/completion 0.6 and no upstream-provider pin. These values describe this run, not permanent pricing.

Automated execution ran from `2026-11-21T12:25:21.578Z` to `2026-11-21T12:31:56.552Z`, approximately 6 minutes 35 seconds. Setup, deterministic checks and investigation were separate. Manual assessment hash `ba154e9d5d69ca493dc68e1466179c02c1cb147468a777bc208b3ebdea7f18dd` records passed checks, unexercised checks and the independent failed execution verdict. The assessment command's exit 1 reflects that accepted failed verdict.

## Closure and retained evidence

The campaign is closed and its lot finished. Its context was revoked and reconciliation completed. Temporary backend credentials were removed with matching-value checks, the task-created private invitation input was deleted, E2E fixture activation is off, environment files were unchanged and the existing worktree services were preserved. Existing model assignments and profile cache preparation remain as standard local configuration. No production application correction, commit, push or extra paid lot was performed.

Native evidence is preserved in the [execution archive record](../../scripts/evaluations/archives/20261121T123210737Z-campaign-documentary-operations-evaluator-fixed-20261121-lot-1/record.json) and [assessment archive record](../../scripts/evaluations/archives/20261121T124418307Z-campaign-documentary-operations-evaluator-fixed-20261121-lot-1-a/record.json). The [verified supplemental closeout archive](../../scripts/evaluations/archives/20261121T124729441Z-documentary-evaluator-fixed-closeout/record.json) preserves the evaluator's final source and tests, RED/GREEN logs, configuration diagnosis, serialized-request measurements and teardown checks (30 files, 1,139,542 bytes).

The mandate allowed one lot, now consumed. A replacement has been prepared without authorization or execution, preserving the same battery and expiry, with a maximum of 60 further model calls and USD 0.98. Combined with this lot, that would remain below the original 80-call/USD 1 envelope. Before any authorized replacement, temporary local setup must provide a valid 30-minute preparation window derived from the existing research authority and restore it afterward; Sources must remain globally disabled. Remaining budget alone does not authorize another lot.

## Subsequent approved replacement

The user later authorized the prepared replacement within the remaining cumulative envelope. Its execution, completed Sources behavior, additional evaluator failure and closure are recorded in the [replacement report](2026-11-21-documentary-qualification-replacement.md). The results and unexercised boundaries above remain evidence for their original lot.
