# Framing continuity and execution corrections

Verified November 20, 2026, on the `sources-workflow-no-legacy` checkout. The approved correction batch is implemented and locally verified. It repairs structural execution contracts; it does not establish improved live judgment or qualify the Sources method. The governing contracts are in [TECH](../../context/TECH.md), with delivery state in the [roadmap](../ROADMAP.md#phase-6--framing-and-controlled-transition).

## Delivered behavior

New Workbench conversations pin definition 9. `adjust_framing` derives its initial and established variants from the canonical framing validators. An initial open proposal must supply `eventBasis.activityExcerpt` in the model-visible schema. After a successful save, the next generation receives the established variant, including legitimate inheritance. Versions 4–8 retain their offered contracts; version 8 remains qualification-only. Shared business feedback identifies the precise invalid field instead of appending contradictory generic alternatives.

An adopted search or reading remains usable for candidate selection, retained continuation and new citations after an agent's provisional save under unchanged mission, active message and instruction authority. All three consumers use the shared observation-authority rule. New requests still pin the current revision, and write authority, adoption, cancellation and generation checks remain enforced. Invalid candidates, invalid continuations, unobserved references and superseded authority produce distinct feedback. Continuation reuses retained text without reacquisition.

Shared settlement no longer creates `repetition_stop` after three non-progress invocations. Both operation settlement and rejected-completion paths retain diagnostics and permit correction within the existing resource envelope. Historical stop records remain readable; stopped missions are not automatically resumed. Actual budget exhaustion, deadlines, cancellation and unknown external effects retain their enforcement. Preparation-stall detection remains separate.

## Regression evidence

RED checks imported the production owners and mocked external provider I/O only. Commands used `pnpm exec vitest run src/__tests__/convex/execution/<file> --maxWorkers=1`, with the relevant files below. Local-only logs are retained in `.agents/artifacts/sources-workflow-no-legacy/`; they are working evidence, not an immutable published qualification archive.

| Regression | Observed RED result | Verified corrected outcome |
| --- | --- | --- |
| `workbench-documentary-continuity.test.ts` | Reading an unread candidate after a save returned unavailable; feedback tests exposed generic errors and a stale citation initially became an unknown outcome. | Seven cases pass: complete search/read/save/read/continue/cite workflow, authority and selection refusals, persisted revisions and no continuation reacquisition. The new citation refusal is registered as recoverable. |
| `workbench-framing-projection.test.ts` | Initial model schema accepted a missing anchor. | Five cases pass through actual Pi serialization and native execution, including repair, schema refresh, inherited subsequent save and retained version declarations. |
| `bounded-refusal-recovery.test.ts`, `repetition.test.ts` | The third refusal blocked settlement. | Workbench/shared Sources and inspection paths continue past the former threshold; diagnostic restoration, objective identity and settlement replay remain covered. |
| `workbench-framing-completion.test.ts` | Repeated rejected completions reached the old stop. | Five invalid completions can be followed by a real save and published completion. This suite and the two shared refusal suites pass all 15 tests. |

The final combined run of documentary continuity, framing projection and native transport passes **60 tests**. Native transport covers correction after repeated refusals and genuine work/output-capacity exhaustion. The malformed-argument test verifies five retained provider replies followed by a sixth invocation refused before dispatch; it does not manufacture a complete reply for that refusal.

A separate final run of `cancellation.test.ts`, `dispatch.test.ts` and `pi-recovery.test.ts` passes **39 tests**, covering cancellation/generation fencing, confirmed effect reuse, unknown dispatch and deadlines. Additional exercised suites cover operation contracts/conformance, protected analyst edits, native admission, history, skill consultation, state observations and framing receipts. Two failures in the wider framing recheck were corrected: an obsolete operation-count expectation and missing recoverable classification for the new stale-citation code. Their focused seven-case rerun passes; the new citation workflow also passes in the final 60-test run. These runs are not a project-wide suite result.

`UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1` regenerated the static profiles through their existing owner and passed seven tests. Application/backend typechecks, Biome on the 24 changed code/generated/test files, execution ownership, import boundaries, resource-policy consistency, documentation checks and `git diff --check` passed. The production build passed with advisory chunk-size and plugin-time notices; the documentation checker retains its advisory TECH word-count warning.

## Local runtime and review

The guarded `pnpm convex:sync --url http://127.0.0.1:3210` completed schema validation and successful function publication to the existing local deployment. The development watcher was preserved. The deployed offline `modelConfigurationActions:refreshProfiles` action prepared the current revisions of the two enabled assigned model catalogues. The deployed administrator query reports both ready and compatible with the new profile catalogue. Assignments, historical revisions and disabled models were not changed. No paid model generation was used for this verification.

Local design review checked the changed owners and their consumers against the approved design and code-smell guardrails. The initial validator derives existing branches; one authority predicate serves access and citation; the existing catalogue and native profile enumeration own version/state variants; the obsolete threshold and both emission branches are removed. No parallel loop, observation store, schema registry or prompt repair mechanism was introduced. No unresolved blocking finding remains in this bounded review; it was performed locally, not by an independent reviewer.

Current TECH and roadmap passages were updated in place. Dated follow-up notes were added to the two relevant historical investigations without rewriting their observations or semantic conclusions. No product requirements, runtime skill content, dependency versions or user interface were changed.

No live model qualification, browser/E2E run, project-wide `pnpm check`, commit, push or remote deployment was performed. New-schema behavior applies to new conversations; retained conversations benefit from shared fixes while keeping their original schema. Removing the premature stop permits greater consumption within existing grants and does not guarantee eventual useful correction. Economic relevance, condition attribution and Sources usefulness still require the separately authorized qualification.

## Qualification-preparation follow-up

The subsequent native runner preflight exposed an obsolete default-version assertion in `separated-agent-context.test.ts`: it expected 7 while the current catalogue correctly returned 9. A targeted search found the same obsolete assertion in `qualification-method-comparison.test.ts`; its explicit historical comparison pins remain 7/8. Both failures were reproduced, only the default-version expectations were corrected, and the two complete suites passed 20 tests. The earlier final checks did not cover these assertions. No production behavior changed in this follow-up; the candidate was frozen again before qualification authorization.

The separately authorized [November 20 live qualification](2026-11-20-framing-v9-live-qualification.md) is now closed with a completed independent failed assessment. It demonstrates live anchor repair and recovery beyond the removed non-progress stop, but leaves post-save documentary continuity unexercised in the inspected live path and semantic acceptance open. This follow-up does not change the original implementation verification scope above.
