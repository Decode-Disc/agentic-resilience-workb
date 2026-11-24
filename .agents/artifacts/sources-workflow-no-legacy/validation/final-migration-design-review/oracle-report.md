**BLOCK — one migration-transition gap remains in the pre-implementation design.** The retained-text storage choice and action-preparation/atomic-adoption architecture are viable. The blocker concerns upgrading existing open retained streams, which the conversation migration does not cover. No additional architectural blocker was found.

Reviewed branch: `sources-workflow-no-legacy`; HEAD: `e8e32ec11983d06a91b582c820e6f097360a35f9`. Before/after checks matched:

- TDD29 SHA256: `865ec50b63c5e294d1f5594a6dff82d3ce049cdbdc2ecc8a8fd697dd9741eb60`
- Outline31 SHA256: `89ab850e96104b4dcb7a4e6574bd6f107e34162581dc61d55981173ca9b9c02b`

Git status remained clean. This is design review, not implementation approval or runtime certification.

**Medium severity, blocking: specify the transition for pre-existing open retained streams before replacing their finalizer.**

[TDD29:170–172](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:170) and [outline31:78–95](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:78) require incremental fragment hashes/end offsets and finalization that reads only the bounded tail. However, existing open streams have a different persisted invariant:

- [retainedText.ts:54–64](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:54) initializes empty `fragmentHashes` and `fragmentEnds`.
- [retainedText.ts:68–102](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:68) persists packed fragments, a rolling hash checkpoint, counts and the tail, without populating those manifest arrays.
- [retainedText.ts:114–149](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:114) currently reconstructs that missing metadata by reading every fragment during sealing.

Consequently, an existing unsealed stream with committed fragments lacks information required by the proposed tail-only finalizer. The aggregate hash checkpoint cannot recover individual fragment hashes or their UTF-16 boundaries. Continuing incremental append from that state does not supply the missing prefix metadata.

This is not exclusively a Pi/conversation transition. [preparationModel.ts:159–193](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:159) writes these streams through one-shot Sources calls; [appendVisibleOutput:124–129](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:124) explicitly handles invocations without a mission. The existing [publication hold:55–69](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/piControl.ts:55) observes Pi mission workers and session leases, not these producers.

The migration inventory and fence in [TDD29:234–241](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:234) concern conversation deliveries/component bodies. They do not explicitly cover this existing retained-stream state. [Outline31:238](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:238) also publishes migration-compatible code before applying the conversation fence.

**Minimal correction:** add a shared-stream upgrade prerequisite before deployment of the changed append/finalize protocol. Inventory old unsealed streams and their producers; prevent incompatible append/seal operations across the transition. Drain eligible producers under the old protocol, or backfill missing manifest metadata through resumable bounded transactions under a stable append frontier. Preserve stranded diagnostic prefixes, text IDs, sequence acknowledgements, hash checkpoints and complete/incomplete status. Do not require a permanent legacy reader, whole-body transaction, research-generation reset or provider replay.

Add an upgrade regression starting from the *old persisted layout* after at least one packed fragment, then exercise append/finalization, interrupted backfill and retry under the new implementation. Include an active one-shot producer and an abandoned incomplete diagnostic. Fresh streams created entirely by the new implementation cannot prove this transition.

**Evidence level:** confirmed source-layout and caller distinction; architectural consequence derived from that layout. No deployment inventory or runtime reproduction was performed, so the presence of affected records on the selected deployment remains unknown.

**Medium severity, nonblocking WATCH: retain the complete Workbench response-control transaction semantics when splitting preparation from adoption.**

The design correctly requires dependency-bound preparation and mutation-time rechecks in [TDD29:193–222](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:193). This remains a consequential implementation acceptance boundary.

[Workbench completion:523–670](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchAgent.ts:523) combines instruction interpretation, current framing/research state, adopted operation receipts, deterministic confirmations and response control. [completeResponseControl:259–311](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/responseControl.ts:259) can persist correction state and test continuation capacity; [lines 376–415](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/responseControl.ts:376) can enqueue advisory work. It is therefore not a pure text validator that can simply move into an action.

The existing `factsRevisionHash` is also narrower than the complete response-review identity: [readResponseFacts:173–193](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/responseControl.ts:173) adds active analyst messages, operation observations and framing receipts before hashing the full facts.

**Required implementation disposition:** retain effectful response-control transitions in the mutation, bind prepared text to all rendering/check dependencies, and preserve correction/unavailable/reserve behavior without hydrating large drafts inside that mutation. Exercise facts changing between preparation and adoption, advisory completion, correction admission failure and lost acknowledgement. These obligations are already substantially present in the TDD; this watch is not a request for another executor or controller.

**Evidence level:** source inspection and existing test inspection; tests were not run.

**Medium severity, nonblocking WATCH: establish durable cleanup ownership from the first staged fragment, including superseded preparations.**

[TDD29:156](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/29-tdd-sources-harness-efficiency.md:156) and [outline31:179–188](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:179) correctly require unpublished-text cleanup and shared-reference preservation.

The primitive itself only creates a keyed text and fragments; it does not register a dossier cleanup relationship ([stageRetainedText:232–298](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:232)). Existing purge discovers invocation text through named references ([dossierPurge.ts:353–398](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/dossierPurge.ts:353)). Linking a new preparation only when it becomes complete would leave a crash window before that link; replacing a preparation after facts change can similarly lose the route to its older staged text.

**Required implementation disposition:** make incomplete and superseded preparations discoverable through their durable owner from initial staging. Define the deletion owner when mission results and deliveries share a final-text reference. Prove interruption after the first fragment, re-preparation under changed facts, purge restart and preservation of still-referenced text. The accepted storage primitive can support this without a generic garbage-collection framework.

**Evidence level:** source-derived ownership risk; no orphan was created or reproduced in this review.

**Low severity, nonblocking WATCH: component retirement must bound bytes, not merely message count.**

The selected component supports resumable deletion, but its [thread deletion implementation:226–235](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@convex-dev/agent/src/component/threads.ts:226) defaults to 100 complete message documents per page. The API’s pagination alone does not establish safe transaction capacity for the largest stored fragments.

**Required implementation disposition:** select a demonstrably safe deletion `limit` using actual record sizes or a conservative platform-derived bound, and verify interruption/resumption before removing the component. Preserve the existing retirement gate in [outline31:259–275](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:259). No component patch or alternate storage choice is required.

**Evidence level:** installed Convex Agent 0.7.9 source inspection; no deletion executed.

**Medium severity, nonblocking WATCH: retained-data performance acceptance remains open.**

[Outline31:255–257](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/31-structure-outline-sources-harness-efficiency.md:255) correctly separates retained-preparation and legacy-ancestry measurements from migration functionality. The [research record](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/43-research-conversation-capacity-and-purge.md:89) identifies incomplete retained graphs and distinguishes synthetic projection measurements from real history-payload replay.

**Required disposition:** preserve that open acceptance item until the complete retained inputs and before/after measurements exist. Missing graphs do not invalidate the storage design, but prevent a full TDD acceptance or claimed measured improvement.

**Evidence level:** documentary evidence inspected; archived measurements were not reproduced.

**Architectural conclusions with no additional finding:**

- The internal action can prepare immutable content without becoming an execution authority. The proposed binding and final mutation rechecks preserve the existing separation, provided the implementation satisfies the watches above.
- Sources acceptance remains appropriately atomic: its current completion processes pending instructions and compares admitted work/revisions before handoff ([sourcesAgent.ts:499–584](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:499)); inspection similarly requires current capture ownership and availability.
- The conversation migration preserves the right identities. Retaining delivery rows, exact text and publication metadata supports original-message references and existing history offsets. The plan correctly distinguishes body hashes from application idempotency hashes.
- Copy, verify, switch, functional verification and retirement are correctly separated. The explicit prohibition on old-only rollback after new messages exist addresses that data-loss risk.
- The seven purge traversals and both nested proposal-parent levels are explicitly covered. Their baseline defects are not evidence against the proposed correction.
- Pi remains the generation/replay/compaction owner. Installed Pi Durable 1.4.0 confirms `afterTools` precedes termination and requires every call to request termination; the existing sole-completion design remains consistent with that behavior.
- No additional speculative abstraction, duplicate executor or necessary reopening of the accepted storage choice was identified.

**Review limits:** no files were edited; no tests, migration, backend publication, browser session, provider/network calls, dependency operations, external notifications or nested delegation occurred. The other new review lane was neither inspected nor contacted. Historical probe results in documents 42, 43 and the storage audit were treated as prior evidence, not rerun results. Deployment contents, action-memory behavior, upgraded-stream recovery, migrated journeys, actual cleanup capacity and retained-data performance remain unverified.

Resolve the open-stream upgrade contract in TDD29 and outline31 before treating this design as ready for implementation without further architectural clarification.


