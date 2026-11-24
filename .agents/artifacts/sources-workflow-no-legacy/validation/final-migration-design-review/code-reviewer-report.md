**REQUEST CHANGES — two medium-severity, blocking compatibility gaps.** The seven-phase direction is feasible, but it needs explicit handling for two existing persisted formats before implementation can safely remove their current consumers. These are design omissions identified from source inspection, not reproduced runtime failures.

Reviewed branch `sources-workflow-no-legacy`, HEAD `e8e32ec11983d06a91b582c820e6f097360a35f9`. Both requested hashes matched before and after review:

- TDD29: `865ec50b63c5e294d1f5594a6dff82d3ce049cdbdc2ecc8a8fd697dd9741eb60`
- Outline31: `89ab850e96104b4dcb7a4e6574bd6f107e34162581dc61d55981173ca9b9c02b`

The tracked checkout remained clean, with no HEAD or reviewed-document drift.

1. **Medium — blocking: phase 1 does not specify how already-open streams acquire the metadata required by incremental finalization.**

   The target requires fragment hashes and end offsets to be maintained during append, followed by finalization without scanning the packed body. See [TDD29:172](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:172) and [Outline31:78](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:78).

   Existing open streams do not have that metadata. They begin with empty `fragmentHashes` and `fragmentEnds`; append persists packed fragment bodies, a rolling checkpoint and counters, but leaves those arrays unpopulated. The current sealer reads every packed fragment to construct them. See [retainedText.ts:54](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:54), [retainedText.ts:71](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:71), [retainedText.ts:88](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:88) and [retainedText.ts:114](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:114).

   Consequently, upgrading append alone cannot recover the missing manifest entries for fragments committed before the upgrade. Removing the scanning sealer without a transition leaves such records unable to satisfy the new finalization contract. This also involves one-shot preparation writers: their streaming callbacks call `appendVisibleOutput` and `sealVisibleOutput`; a Pi worker hold alone does not establish that these producers have drained. See [preparationModel.ts:181](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:181) and [invocationLifecycle.ts:145](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:145).

   **Minimal correction:** add a phase-1 upgrade prerequisite covering pre-existing open streams. Either establish and verify a fence/drain that leaves no old-format stream requiring further append/finalization, or specify a resumable, bounded metadata backfill under the existing text owner. Preserve incomplete diagnostic content, existing sequence identities and hashes. Do not restore a whole-body transaction as the compatibility path.

   **Required verification:** capture baseline-produced open-stream state before refactoring, including a packed fragment and tail; then append/finalize through the new owning boundary. Verify exact restoration, unchanged append identity, interruption/retry during conversion, and bounded transaction work. An all-new stream test does not exercise this upgrade.

   **Evidence level:** current representation and producer chain inspected; affected records on the eventual deployment are unknown. No runtime reproduction was performed.

2. **Medium — blocking: the delivery migration does not define conversion/read compatibility for existing completed textual mission results.**

   The target changes Workbench and conversation-validation outcomes to reference retained final prose and reuse that reference for publication, avoiding another JSON body copy. See [TDD29:215](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:215) and [Outline31:114](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:114).

   Existing completed missions have two persisted encodings: an inline `result` containing `text`, or a `resultTextId` containing the serialized result object. Both are explicitly supported today. See [missionData.ts:188](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionData.ts:188), [missionData.ts:209](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionData.ts:209), [workbenchContracts.ts:408](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchContracts.ts:408) and [conversationValidationContracts.ts:6](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/conversationValidationContracts.ts:6).

   The detailed migration inventories and switches delivery/component references; it does not describe converting these existing mission outcomes. See [TDD29:234](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:234) and [Outline31:202](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:202).

   Migrating the delivery therefore does not by itself establish compatibility with the new compact outcome. Removing the old result consumer without a conversion can break retained-result inspection or terminal recovery; keeping the old full-result hydration indefinitely leaves the removed whole-body path and duplicate final-prose representation unresolved. This matters particularly when publication committed before native acknowledgement: current `publicationState` reads the mission result, and Pi uses the rendered final prose to reconcile its transcript. See [piControl.ts:1032](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/piControl.ts:1032) and [piMission.ts:1639](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:1639).

   TDD29 already requires an explicit version/read-compatibility strategy for changed result shapes at [line 90](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:90); that strategy remains unspecified for this persistence change.

   **Minimal correction:** distinguish domain/model result validators from the new persisted outcome representation, and extend the migration inventory to existing textual mission results. Specify how inline and fragmented results become verified references—reusing the migrated delivery’s final-text reference where equality and ownership permit—and how completed missions awaiting native settlement recover across that conversion. Preserve definition pins and immutable invocation/journal bytes.

   **Required verification:** use baseline-produced inline and fragmented completed results, including a completed-but-unsettled session. Migrate and reopen under the new handlers, then verify exact final prose and confirmations, one delivery/completion, unchanged provider/effect accounting, successful terminal settlement and inspection with Convex Agent absent. Fresh post-change recovery tests alone do not cover the transition.

   **Evidence level:** persisted formats and recovery consumers inspected; no schema publication, conversion or recovery execution performed.

No additional actionable design findings emerged from the inspected boundaries:

- The action/preparation split binds immutable content to execution identity and requires mutation-time authority, dependency and outstanding-work rechecks. It preserves domain acceptance in its existing owners.
- The migration correctly separates application identity hashes from body hashes, specifies exact historical extraction, retains sources through equality and functionality verification, and blocks early retirement.
- Both public history readers, native consultation, original Sources wording, queue/steering, approvals, copy/retry and publication recovery are explicitly included.
- All seven demonstrated purge traversals and both nested proposal-parent dimensions are named. Parent and child boundary tests are distinguished.
- The TDD workflow selection is appropriate: defect reproduction at existing boundaries, characterization for extraction/refactoring, and falsification for genuinely new seams. Planned tests cover substantive failure classes rather than helper-call counts.
- Retained preparation and legacy ancestry measurements remain explicitly open. Historical probes and synthetic measurements are not presented as current deployment acceptance.
- The proposed owners do not require a speculative storage framework or second completion executor.

I read both documents fully, the required project contracts and skills, the supplied prior evidence, relevant production/test consumers, and installed Convex Agent/Pi source. No files were edited; no tests, browser checks, migrations, backend/provider calls, dependency operations, notifications or nested delegation ran. I did not inspect or communicate with the new Oracle lane.

Runtime capacity, deployed migration integrity, browser behavior, retained-data performance, profile refresh and post-retirement functionality remain unverified by this review.


