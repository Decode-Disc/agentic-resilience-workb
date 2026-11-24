---
type: structure-outline
flow: tdd
status: ready-for-review
revised: "2026-11-24"
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "c59e2defab5849d6a2d084536d99570b6fcf6d1e"
---

# Progressive Storage, Verified Message Migration and Sources Corrections

Implement the remaining work in the [revised, user-approved TDD 29](29-tdd-sources-harness-efficiency.md). The current [implementation review](42-review-current-sources-implementation.md), [research](43-research-conversation-capacity-and-purge.md) and [storage audit](validation/storage-choice-audit/audit.md) establish the defects and measurement gaps. The user requested correction of the [final independent review](44-review-migration-design-and-outline.md): this revision adds the existing-stream upgrade and completed-result migration, with all four implementation watches mapped below. The reviewers examined the prior snapshots, not this correction. Design correction does not execute implementation, migration, deletion or qualification.

## Desired End State

All conversation messages use existing retained-text fragments, with invisible preparation, atomic publication by reference and bounded reads. Existing messages are migrated once with their exact text, application identities and references preserved. Existing conversation, Sources, approval and native recovery behavior must work on the migrated data before obsolete component copies and Convex Agent are removed. Temporary migration copies and tooling are retired; normal application readers never silently fall back to old storage.

The same progressive mechanism replaces every use of `retainCompleteText`, `readRetainedText` and `sealRetainedText`, including journal, mission results, native observations, invocation finalization and fixtures. An internal Convex action prepares immutable content; the final mutation rechecks current authority and domain state before adoption. Dossier purge reaches every owned child batch. Pi retains generation, replay and compaction; domain owners retain evidence, human decisions and accounting.

## Verified Baseline and Outstanding Evidence

The [original outline snapshot](validation/outline-progressive-storage/31-before-revision.md) preserves its completion markers. The [implementation record](32-implementation-sources-harness-efficiency.md) and review 42 establish the following baseline; these are historical results, not tests rerun during this outline revision.

- [x] Current preparation progress and precise action applicability, with completed-old consultation replay and fresh v3 admission.
- [x] Common 64 KiB history capacity, full native success envelope, authenticated target/frontier continuity and retained payload replay.
- [x] Native sole-call completion, mixed-round refusal, structured terminal recovery and versioned default activation.
- [x] Baseline profile preservation and database-backed profile refresh tests; existing integrated regression and documentation work.
- [ ] Retained-preparation read-cost measurements across all three consumers and retained legacy cursor-ancestry cost. The previous checked boxes overstated synthetic evidence; review 42 reopens these obligations.
- [ ] Deployed behavior of the revised path, verified migration and post-retirement functionality.

Do not implement the original five phases again or reserve their already-existing agent versions. Preserve applicable supported bindings and the separate legacy retirement already performed. Rerun affected baseline checks when this correction changes their boundary. The original Oracle review does not certify the new action/preparation or migration design.

## Implementation Overview

- [ ] Phase 1: Make shared text staging, finalization and reads bounded, including the existing-stream upgrade.
- [ ] Phase 2: Adopt prepared results atomically and remove whole-body consumers.
- [ ] Phase 3: Preserve conversation behavior through bounded body access.
- [ ] Phase 4: Complete dossier purge across every parent and child batch.
- [ ] Phase 5: Build and rehearse the resumable message and completed-result migration.
- [ ] Phase 6: Migrate the selected deployment and verify functionality before retirement.
- [ ] Phase 7: Retire obsolete storage and verify the final application.

```text
1. Shared progressive storage -> 2. Prepared adoption -> 3. Conversation consumers
             |                                             |
             +-> 4. Complete owned-data purge               |
                           \_______________________________/
                                           |
                               5. Migration rehearsal
                                           |
                     6. Copy + compare + switch + verify
                              OLD COPIES STILL RETAINED
                                           |
                            7. Retire + verify again
```

Phase 4 is independent of conversation UI work once shared text ownership is established. Keep one implementation line unless a concrete isolation need appears. Phases 1–5 implement and rehearse the new contracts without activating them on existing data. Phase 6 must first deploy the additive transition guards and backfill procedure, complete the shared-stream prerequisite, then activate changed append/finalize and message/result readers only after their inventories are converted. Publishing the final code before this prerequisite is unsafe even when conversation migration has not started. Use additive transitional schema fields and an explicit maintenance fence; do not introduce a permanent rollout framework or per-read fallback. Tests can exercise the new path on fresh/migrated fixtures before runtime cutover.

## Execution and Evidence Rules

Recheck branch, HEAD, user edits, installed SDK tuple and current catalogue before implementation. Before phases 1–3 change their owners, capture baseline-produced stream states, inline/fragmented completed textual outcomes, a completed-but-unsettled session and exact historical message extraction. Freeze their original bytes and observed outputs for phase 5; do not hand-create a convenient old format after replacing its producer. Preserve baseline profiles and immutable measurement inputs before changing their consumers. Recover the full retained preparation and predecessor-request graph needed for cost measurements; the current archive export is incomplete. If those records cannot be obtained, record the precise missing data and keep that acceptance item open. Do not label synthetic reconstruction as retained evidence.

Use the existing `tdd` and `code-smell-guardrails` procedures. Reproduce known defects through real registered boundaries before fixing them. Characterize exact extraction, ordering and idempotency before refactoring. If a genuinely new internal boundary is required, establish its real collaborators, then cover its outcomes and falsify the guarded failure groups. No copied production logic, internal mocks, pass-through tests or assertions weakened for green. Use external provider fixtures without paid calls.

Record commands, intended RED failures, GREEN results, capacity/read measurements and limitations per phase. The earlier 18,874,369-byte storage probe and eight-message hydration failure provide reproducible starting cases, not arbitrary application limits. Verify actual transaction/function/document constraints and action memory. Preserve current resource grants, domain artifact capacity, provider accounting and cancellation; do not add a generation-size cap or restore `repetition_stop`.

Use focused tests during edits and format changed files once after stabilization. The commands below are verified repository commands and existing suites; newly named suites must be created before their command is run. They are planned checks, not results of this outline revision. Keep generated declarations and profiles owned by their generators. A backend typecheck is not a publication check. Before any authorized local publication, inspect `pnpm dev:status --json`, preserve the existing watcher and follow [local publication controls](../../../context/TECH.md#local-development). A live deployment identity, migration inventory and rollback/recovery record are execution prerequisites, not reasons to reopen the accepted storage choice.

## Phase 1: Make shared text staging, finalization and reads bounded

Deliver incremental stream completion without whole-body rereads and retain the existing immutable staged/range contract. Capture the pre-change logical read/write costs first.

### Change Outline

| Owner | Change |
| --- | --- |
| `convex/execution/retainedText.ts` | Add the resumable old-stream metadata backfill and explicit upgrade readiness check. Preserve the frozen prefix, tail, checkpoint and sequence acknowledgements; refuse changed frontiers. Maintain fragment hashes, end offsets and whole-content checkpoint as fragments commit. Finalization handles only the bounded tail and verifies totals. Keep idempotent ordering, exact Unicode content, manifest integrity and bounded deletion. |
| `convex/execution/invocationLifecycle.ts`, one-shot preparation admission and existing publication controls | Add the temporary admission/write fence covering all append/seal producers, including one-shot Sources calls without a mission. Already-dispatched calls drain under the old protocol before conversion; do not treat absent Pi leases as proof. Connect visible-output append/finalization to the progressive owner; retain incomplete prefixes and terminal reasons as diagnostics, never completed evidence. |
| `convex/integrations/piStorage.ts`, `convex/execution/piStore.ts` | Reuse existing separate stage/publish transactions and conformance. Keep session writer/lease authority specific to Pi; unrelated writers use their own authority. |
| Existing journal and streaming tests | Exercise the changed owner through actual append, finalization and native persistence consumers rather than a copied storage implementation. |

```text
upgrade        -> fence admissions -> drain old producers -> freeze writes
                  -> bounded resumable manifest backfill -> verify frontier
ordered append -> bounded durable fragments + incremental manifest
finalize       -> bounded tail + complete manifest
publish/read   -> owning authority + verified reference/range
```

Do not merely rename a whole-body loop or move it into another mutation. Full manifests themselves must fit actual platform limits; report explicit capacity failures. The obsolete complete-write/read APIs may remain only for identified callers awaiting phase 2, with no new use introduced. Keep the transitional release publishable separately from the final code: it adds guards and bounded backfill while preserving old execution until producers drain. Under the write fence, backfill each old unsealed stream incrementally at the existing text owner; verify hashes, offsets, packed-prefix checkpoint and counters before readiness. Preserve incomplete diagnostics rather than sealing or discarding them. No permanent legacy sealer or whole-body compatibility fallback remains after activation.

### Validation

- [ ] Capture baseline-produced open-stream fixtures before refactoring: packed fragment plus tail, tail-only stream, active one-shot Sources producer and abandoned incomplete diagnostic. Preserve original hashes, sequence acknowledgements and visible-output status.
- [ ] RED: reproduce whole-body finalization capacity failure and missing-prefix metadata after upgrading the old persisted layout at the existing append/finalize boundary.
- [ ] Verify admission hold before paid dispatch, draining of already-dispatched one-shot work, stale callback refusal, interrupted/retried backfill, changed frontier refusal and activation blocked by unresolved streams. Append acknowledgement replay, next append and new finalization must restore exact text without changing old IDs/checkpoints or incomplete diagnostic status; measure each transaction.
- [ ] GREEN: exact restoration beyond the old transaction failure, separate transactions, bounded finalization work, repeated/lost acknowledgements, changed/out-of-order fragments, false full hash, incomplete manifest and Unicode fragment edges.
- [ ] Preserve Pi reopen, lease renewal, stale/cancelled writer refusal and committed-prefix inspection. Measure logical rows/bytes including manifest work; record action memory separately where relevant.

```sh
pnpm exec vitest run src/__tests__/convex/execution/journal.test.ts src/__tests__/convex/execution/pi-storage.test.ts src/__tests__/convex/execution/pi-store.test.ts src/__tests__/convex/integrations/model-streaming.test.ts --maxWorkers=1
```

Exit: the existing durable consumers prove bounded persistence and exact content. A helper-only capacity success does not establish final publication.

## Phase 2: Adopt prepared results atomically and remove whole-body consumers

Deliver the action-to-mutation completion contract across real invocation, journal, publication and native acknowledgement paths. Preserve original response bytes and definition-owned validation.

### Change Outline

| Owner | Change |
| --- | --- |
| `convex/execution/journal.ts` and callers | Stage immutable received/adopted responses and event/context payloads before linking them. Return authorized references/ranges; preserve event-time identity and do not let an older event acquire a later response. |
| `convex/execution/invocationLifecycle.ts`, `agentDefinition.ts`, existing model/native integration | Prepare content in an internal action using original arguments and pinned validators. Bind the preparation on its invocation to mission/generation, definition, instructions, admitted-input/response hashes and rendering dependencies. Final mutation validates those identities, current authority and domain readiness before adopting once. |
| `convex/domain/workbenchAgent.ts`, `convex/responseControl.ts`, conversation publication | Prepare exact final text, including deterministic confirmations; retain response-control fact/draft identity and correction rules. Publish the final retained reference with delivery/turn/result adoption atomically. A raw draft is not automatically the public response. |
| `convex/execution/missionData.ts`, `piControl.ts` | Separate pinned model/domain result validation from the versioned persisted textual outcome (kind/non-body metadata plus complete final-text reference). Persist compact validated outcomes and retained text references. Old inline and retained-JSON outcome conversion belongs to phase 5 and gates activation in phase 6. Return completion identity/reference for settlement rather than rebuilding the full result or published text in a query. |
| `convex/execution/piStore.ts`, native consumers | Read context observations in bounded calls and acknowledge their sequence only after complete verified reconstruction. |
| `convex/execution/fixtures.ts`, protected administration and tests | Convert every remaining complete-body consumer through the real owner. Remove all three obsolete exports only after repository-wide caller coverage. |

```text
retained original response
  -> internal action: exact content + schema + dependency-bound preparation
  -> finish: live authority/instructions/domain checks
       refusal/wait -> existing Pi continuation
       adoption     -> result + publication + terminal identity, atomically
  -> native acknowledgement/recovery reads the adopted identity
```

Database-backed ID validation and Sources evidence/accounting remain in the mutation. `completeSources`, inspection membership and numeric validation retain their existing bounded domain contracts. No client/model-provided `validated` flag is authoritative. Bind preparation to the full `readResponseFacts` projection, including active messages, observed operations, consulted material and framing receipts, not only `factsRevisionHash`. A changed dependency identity requires fresh preparation or the existing continuation outcome, not stale publication. Keep response-control correction writes, continuation admission, advisory scheduling and unavailable/reserve behavior in the mutation. Register every preparation attempt with its durable owner in the first fragment transaction; retain superseded attempt references until their exclusively owned text is cleaned up, without an unbounded list on the invocation. Keep all runtime arguments/returns bounded; moving `JSON.parse` into an action while returning the full body to a mutation is not completion of this phase.

### Validation

- [ ] RED at registered consumers: large retained response/recovery, mission result, native observation and final publication expose the old aggregate boundary. Isolate the expected failure from fixture setup.
- [ ] Cover swapped references, wrong definition/input/instruction identity, incomplete fragments, revoked authority, changed facts between preparation/adoption, newly engaged work, duplicate finalization and interruption on either side of adoption.
- [ ] Preserve sole/mixed completion, original wire arguments, structured correction beyond three invocations within authority, Workbench advisory behavior and one domain effect/provider settlement after lost acknowledgement.
- [ ] Exercise full-review facts changing while the narrower facts hash stays unchanged, advisory completion, correction admission failure and lost acknowledgement. Check the actual correction/reserve state and once-only effects.
- [ ] Crash after initial staging and after changed-facts re-preparation; verify both current and superseded preparations remain discoverable by purge.
- [ ] Exercise large Workbench text with final confirmations and native settlement on the new storage-backed publication owner. Public/UI paging is verified in phase 3.
- [ ] Add focused registered coverage for each named consumer, then verify no production/test callers or exported aliases of the three whole-body APIs remain.

```sh
pnpm exec vitest run src/__tests__/convex/execution/journal.test.ts src/__tests__/convex/execution/pi-native-transport.test.ts src/__tests__/convex/execution/pi-recovery.test.ts src/__tests__/convex/execution/pi-response-control.test.ts src/__tests__/convex/execution/response-control.test.ts src/__tests__/convex/sources/sources-completion.test.ts src/__tests__/convex/sources/sources-completion-correction.test.ts src/__tests__/convex/sources/sources-completion-freshness.test.ts --maxWorkers=1
rg -n 'retainCompleteText|readRetainedText|sealRetainedText' convex src scripts
```

The final search must have zero executable callers; exit 1 from `rg` means no matches. Review explanatory/history matches individually. Record actual action memory and transaction costs at the complete publication boundary, not only retained-text storage.

## Phase 3: Preserve conversation behavior through bounded body access

Deliver one logical message per existing delivery, with explicit partial loading and exact full-content access. Preserve the current interface and instruction semantics.

### Change Outline

| Owner | Change |
| --- | --- |
| `convex/execution/conversations.ts`, `convex/workbench.ts`, execution schema | Add typed retained body references and separate delivery pagination from body range continuation. New writes use invisible staging and atomic visibility. Keep transitional source fields until verified retirement. |
| `convex/execution/history.ts` | Read intersecting body ranges before fitting the model result. Preserve message/turn identity, frozen publication frontier, old issued cursor positions and exact offsets. |
| `readTurnInstructions`, `convex/domain/workbenchInstructions.ts`, context/control/native input consumers | Retrieve complete authorized instructions through bounded transport; do not feed them a display prefix. Preserve original wording, treatment, operation references and authority semantics. |
| `src/components/workspace/start/connected-start-workspace.tsx` and current message owners | Assemble ranges within the same logical message through Convex hooks. Preserve ordering, scroll, copy/selection, retry, queue/steering, approvals, loading geometry and desktop/mobile composition. |

Apply `workbench-frontend` to this scope, with the existing UI as baseline. No redesign, lost affordance or new dependency is needed. Keep domain rules on the server. Refusal must not become an empty successful message or a fallback to Convex Agent.

### Validation

- [ ] Reproduce both public-reader aggregate failures and the full-load-before-small-page defect; verify bounded reads on multiple large messages and one large body.
- [ ] Cover delivery-page continuation while a body is incomplete, exact-fit/overflow JSON envelopes, non-BMP/escaping boundaries, interrupted loads/retry and no skipped/duplicated text. Authorization binds the retained reference to its owning delivery.
- [ ] Preserve old history receipts and native transcript contents above 50 KiB and at the common 64 KiB value plus wrapper. Keep mission target/ancestry regressions and current profile behavior.
- [ ] Exercise Sources original-message projection, active/queued/steered instructions, approvals, control replay and publication. A small display page cannot truncate native input.
- [ ] Test rendered workflows with the real module and existing reference-routed hook harness; verify partial/error/loading, exact copy behavior and successful resume. Capture and compare the affected browser surface before/after on desktop and mobile when implementation runs.

```sh
pnpm exec vitest run src/__tests__/convex/execution/conversation-capacity.test.ts src/__tests__/convex/execution/conversation-history.test.ts src/__tests__/convex/execution/conversation.test.ts src/__tests__/convex/execution/conversation-admission.test.ts src/__tests__/convex/execution/pi-steering.test.ts src/__tests__/convex/execution/pi-publication.test.ts src/__tests__/convex/sources/sources-instruction-projection.test.ts src/__tests__/convex/sources/sources-instructions.test.ts src/__tests__/components/workspace/connected-start-workspace.test.tsx src/__tests__/components/workspace/conversation.test.tsx --maxWorkers=1
```

Exit: new and migrated fixtures exercise the normal new reader. Production cutover still waits for migration verification; do not silently switch existing records before their references are ready.

## Phase 4: Complete dossier purge across every parent and child batch

Fix the seven demonstrated traversal defects at their existing owner. This phase repairs ordinary dossier purge; it does not turn message migration into dossier deletion or quota restoration.

### Change Outline

In `convex/dossierPurge.ts`, advance every parent set to exhaustion while draining its children before removing the parent. Correct `claimEvidence`, `sourcePassages`, `proposalItemsAndReviewItems`, `proposalsAndPreparations`, `sourceCapturesAndPreviews`, `piCommitsAndSessions` and `agentInvocationPayloads`; revision/proposal traversal has two independent parent levels. Reuse the valid ownership/progress pattern in operation/invocation cleanup rather than introducing a generic traversal framework.

Connect prepared-but-unpublished text to its durable owner in the first staging transaction, including superseded preparations. When a final-text reference is shared by mission result and delivery, each remains a reachable owner and deletion waits until both release it; a checkpoint retaining source data also prevents early cleanup. Keep checks in the existing owners rather than adding a generic garbage collector. For shared references, preserve existing reference checks and ownership rules; do not infer exclusivity from an ID prefix alone. Keep authority revoked before deletion and prevent late writers from recreating children. Ordinary dossier purge retains its existing once-only audit/quota semantics.

### Validation

- [ ] RED: later parents retain owned children after purge, including an empty first parent window. Cover all seven steps, not just invocation payloads.
- [ ] Use parent populations spanning `2 * DOSSIER_PURGE_BATCH + 1`, empty and populated prefixes, and child counts `0`, `B`, `B + 1`, `2B + 1` where they distinguish traversal guards. Cover both nested proposal levels without a redundant Cartesian test matrix.
- [ ] Interrupt after real child deletion and restart; repeat completion; verify zero owned orphans, unrelated dossier preservation, first-fragment and superseded-preparation cleanup, shared mission/delivery text preservation until both references are released and quota/audit idempotence.
- [ ] Measure bounded transaction work on large retained fragments and test a stale writer attempting persistence after purge admission.

```sh
pnpm exec vitest run src/__tests__/convex/access/dossier-purge.test.ts src/__tests__/convex/execution/pi-store.test.ts --maxWorkers=1
```

Exit: child and parent traversal dimensions are proven independently. A single 101-child example or a missing parent row is insufficient evidence of complete cleanup.

## Phase 5: Build and rehearse the resumable message and completed-result migration

Deliver a one-time internal migration procedure and durable checkpoints, with old copies retained throughout copying and validation. Keep conversion in the existing conversation and mission-result owners; it must not become another runtime message service.

### Change Outline

Add the migration procedure beside the existing conversation/storage owners, with task-specific checkpoint validators in the existing schema owner. Each delivery checkpoint binds source thread/reference/order, source body hash, target retained manifest and copy/verification/switch/retirement state. Add per-mission checkpoints for inline `result` and retained JSON `resultTextId`, including completed-but-unsettled sessions and textual outcomes without deliveries. Freeze status, definition pins and source identity; register destination staging from its first fragment. The deployment inventory records the selected scope, stream-upgrade readiness and verification evidence. Keep checkpoint collections bounded; never put the entire deployment inventory in one document.

```text
verified stream upgrade + message/result inventory + old-write fence
  -> read source component fragments and old mission results in bounded calls
  -> stage destination by stable delivery or mission identity
  -> independently compare exact source and destination
  -> switch delivery and mission outcome references under maintenance fence
  -> record functional-verification status
  -> retirement remains refused until that status is proven
```

The temporary reader handles both single IDs and ordered JSON-array references. Reproduce current extraction exactly, including newlines between text parts within a component message and no added separator between component fragments. Do not call aggregate `readConversationMessages` for bulk migration. Body hashes are computed independently: control request hashes are not necessarily text hashes and must remain unchanged.

The temporary mission decoder belongs to `missionData`: validate old inline/retained-JSON results with their pinned semantic contract in an internal action, preserving non-body fields. Resolve exact final prose using the historical renderer without rerunning domain completion or current confirmations. Reuse the migrated delivery text only after exact equality and ownership checks; stage a separate result for a mission legitimately without delivery. A linked delivery mismatch, missing supported definition or corrupt old result blocks conversion. Atomic conversion compares the frozen source identity and leaves old fields/artifacts available only to migration verification until retirement. New runtime inspection/settlement reads only the compact outcome.

Source copies stay intact; failed copying or comparison never fabricates a body or deletes the source. Compare source references again when switching. Preserve conversation/delivery/turn IDs, publication revisions, timestamps, roles, request keys, incoming references and old cursors. Inventory unknown component-only records separately and block their retirement until ownership is established. Prevent automatic conversation recreation or old publication while the fence is active, without cancelling independent Sources work or changing research authority.

### Validation

- [ ] Characterize old extraction before writing the migration reader. Exercise source and destination owners through real Convex/component boundaries, with transaction limits enabled.
- [ ] Add `src/__tests__/convex/execution/conversation-storage-migration.test.ts`: exact single/multipart/control/Unicode content, unchanged identities and all incoming references, large bodies/pages, repeat/resume and interrupted switch.
- [ ] Refuse missing/foreign/mutated source fragments, false destination hashes, incomplete manifests, scope mismatch, unknown ownership and deletion before verification. Assert the old copy remains intact on each refusal.
- [ ] Start from baseline-produced inline and fragmented completed textual outcomes, including missing delivery and completed-but-unsettled session cases. Verify exact prose/confirmations and non-body metadata, shared-reference ownership, unchanged definition pins/invocation/journal bytes, migration restart and mismatch refusal. Reopen inspection and native recovery through the new handlers with one result/delivery and unchanged effect/provider accounting; repeat with the component absent in phase 7.
- [ ] Rehearse old writers during the fence, native acknowledgement recovery, and restart at each durable checkpoint. No duplicate messages, operation effects or provider redispatch.
- [ ] Test recovery after new messages exist: an old-only rollback cannot be considered safe; preserve new retained bodies and their references. No permanent dual-write or automatic reader fallback.

```sh
pnpm exec vitest run src/__tests__/convex/execution/conversation-storage-migration.test.ts src/__tests__/convex/execution/conversation-history.test.ts src/__tests__/convex/sources/sources-instruction-projection.test.ts src/__tests__/convex/execution/workbench-approvals.test.ts src/__tests__/convex/execution/pi-recovery.test.ts --maxWorkers=1
```

Exit: a migration rehearsal proves data preservation, refusal and restart through real collaborators. It does not certify the selected deployment or authorize early retirement.

## Phase 6: Migrate the selected deployment and verify functionality before retirement

This is the operational migration and acceptance boundary. Before execution, record the authorized deployment identity, actual inventory, writer-fence procedure, recovery procedure and verified code revision. A missing deployment selection or required authority stops this phase; do not assume production. Preserve source copies until every required migration and functionality check passes.

### Change Outline

First publish the additive transitional release from phase 1 through the established deployment path and verify the successful push. Hold new stream producer admission, including one-shot calls before dispatch; let already-dispatched producers finish or record failure under the old protocol. Fence append/seal, inventory all remaining unsealed texts, run bounded resumable metadata backfill and verify unchanged frontiers. Unknown producers, active writers or incompatible streams block the changed append/finalize release. Keep abandoned diagnostic prefixes and their incomplete status. Then activate the new protocol under the maintenance fence, copy/compare all message bodies and completed textual mission outcomes, and switch both references before enabling the new readers or native settlement. Record stream inventory/upgrade readiness, delivery and mission copied/verified/switched counts and per-record evidence; inventory equality, not a sample, establishes migration completeness. Resume the new path only after its relevant checks pass. Do not reset Pi sessions, delete domain records or replay model calls to simplify conversion.

Run current-data read checks and controlled zero-provider state-changing fixtures through the deployed functions and real interface. Record commands/tool calls, selected records, expected outcomes and actual results so another operator can reproduce the evidence. The migration's own persisted verification state must be tied to these concrete outcomes and the relevant code/data revision; merely setting a boolean cannot authorize retirement after a failed or incomplete check.

### Validation

| Required behavior on migrated data | Observable evidence before retirement |
| --- | --- |
| Exact history and references | Every body matches; IDs/order/metadata remain unchanged; both public readers and issued pre-migration cursors restore the intended content. |
| Conversation interaction | New user/reply messages, queue, steering, stop/recovery and deterministic confirmations retain their behavior. Desktop/mobile loading, scrolling, copy and retry remain usable. |
| Sources requests | Original analyst wording, interpreted need, treatment and result remain inspectable through both Sources and Workbench context. No deleted-original exception is introduced. |
| Analyst control | Pending and decided approvals and grants remain valid under their original authority; no implicit approval/denial, quota change or evidence deletion. |
| Completed textual outcomes | Every old inline/fragmented result resolves exact final prose and non-body metadata through the compact outcome; preserved definition pins and shared ownership; inspect results with and without deliveries. |
| Durable execution | Resume baseline completed-but-unsettled and other native sessions; inject acknowledgement loss on controlled fixtures; one published result, no repeated domain effect/provider call, unchanged receipts/accounting. |
| Failure containment | Interrupted migration resumes; corruption or runtime failure leaves old copies intact and retirement blocked; recovery preserves messages created after switch. |

Re-run the focused suites from phases 2, 3 and 5 for the final code revision. Component tests do not replace the deployed/UI checks above. Do not run paid qualification as an incidental migration check.

Complete retained-data measurements on the recovered immutable preparation and predecessor graph. Compare before/after actual rows and bytes for Sources context, Workbench context and standalone consultation, including reads outside `SourceReviewReads`; measure ancestry lookup separately from event-body traversal. Preserve data/hash provenance and explicit capacity outcomes. The existing `history-read-cost.test.ts` supports `HARNESS_REAL_TRAVERSAL_INPUT` and `HARNESS_REAL_PERF_OUTPUT`; use an actual validated payload file, not its synthetic default, when claiming retained traversal evidence. Extend the existing measurement suites for the other retained graphs rather than adding another execution harness.

Exit: all required migrated-data/functionality checks pass with old copies still present. A missing retained-data cost graph remains an explicit performance acceptance gap, not a substitute for or an excuse to skip functional verification. Report that gap separately; do not claim the entire TDD accepted until its evidence obligations are satisfied.

## Phase 7: Retire obsolete storage and verify the final application

Only after phase 6's data and functionality evidence passes, remove verified obsolete component copies through the component's bounded deletion APIs while they are still installed. Set an explicit limit justified by measured record bytes or a conservative platform-derived maximum, including complete message documents and transaction overhead; do not assume the default 100-message page is safe. Record the largest-record case and interrupt/resume evidence before removal. Recheck inventory/reference ownership before each retirement step; unknown or remaining users block deletion. Recovery must tolerate interruption without touching the authoritative retained bodies.

### Change Outline

Remove `agentConversations.storageRef`, old delivery source fields, obsolete inline/result-JSON fields and decoders, temporary stream-upgrade guards/progress and migration-only code/checkpoints when no longer needed, the old adapter, component registration, package dependency and test registrations. Follow the dependency-installation workflow and established pnpm command; do not hand-edit the lockfile or introduce unrelated upgrades. Regenerate declarations through their owner. Retire old result-text artifacts only after their owner confirms no live or immutable audit reference remains. Retained raw/audit artifacts stay distinct from a runtime result fallback; never delete shared final text still referenced by a mission or delivery. Preserve migration evidence outside executable code; if some checkpoint is still required for recovery, report retirement as incomplete rather than leaving an unexplained compatibility mechanism.

Search application, tests, generated outputs and configuration for component calls, dual-write/fallback paths and the three obsolete helper names. Restore fixtures to the single final representation. Re-run representative migrated-data checks with Convex Agent absent; uninstalling a package is not evidence that every consumer works.

Update `context/TECH.md` for actual storage, preparation/adoption, range access and completed migration/retirement. Update `docs/ROADMAP.md` only with verified capability and remaining limits. Add dated supersession notes to affected historical descriptions without rewriting their original rationale. Keep tracked documentation free of links into ignored artifacts.

### Validation

- [ ] Component cleanup has measured row/byte bounds on large records, interruption/resumption coverage, is limited to verified obsolete copies and impossible before data/functionality acceptance.
- [ ] Final schema and dependency checks establish one canonical message representation, no runtime legacy reader/dual-write, and no whole-body storage API or disguised equivalent.
- [ ] Repeat migrated history, new-message, Sources/approval and native-recovery checks after component removal; preserve hashes, IDs, effects and accounting.
- [ ] Preserve unchanged historical serializer keys under the same SDK tuple. If schemas/native inputs change, regenerate measured keys and verify configured database profile refresh for changed and unchanged catalogue revisions. Never reuse an old estimate for a changed input or silently rebind a mission.
- [ ] Format and diagnose changed files, then run `pnpm check` once for the final transversal change across shared storage, completion, schema, UI consumers and dependency removal. A later docs-only edit invalidates only documentation checks; do not repeat the full aggregate without cause.

```sh
pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts src/__tests__/convex/admin/model-configuration.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-default.test.ts --maxWorkers=1
node --experimental-strip-types scripts/check-execution-boundaries.ts
pnpm resource-policy:check
pnpm check
```

If profiles changed, precede the first command with the existing `UPDATE_PI_INPUT_PROFILES=1` serializer test and rerun without that flag. Run no generation merely because this document lists it. Review design quality: one owner per shared rule, no second completion executor, speculative storage framework, copied validator or error-masking fallback. Record each acceptance item with executed evidence and its limits; live semantic usefulness remains separate from deterministic migration correctness.

## TDD and Review Coverage

| Obligation | Phase and exit evidence |
| --- | --- |
| Progressive text, incremental finalization, real capacity | 1 and 2: complete registered consumers, bounded reads/writes, exact content and measured memory. |
| Journal, missionData, piStore, invocationLifecycle and fixtures | 2: every whole-body caller replaced, exports removed and downstream consumers tested. |
| Internal preparation and atomic adoption | 2: exact identity binding, current-state refusal, original arguments, one effect and recoverable native tail. |
| Public/native history and UI continuity | 3 and 6: both public readers, complete instructions, old cursors, exact native delivery and real rendered behavior. |
| Seven incomplete purge steps | 4: later parents, nested revisions/proposals, child dimensions, restarts, isolation and quota/audit checks. |
| Existing stream upgrade | 1 and the prerequisite in 6: old persisted packed-prefix fixtures, all producer admission/drain/write fences, bounded resumable backfill, no changed identities/status, and no new protocol before readiness. |
| Completed textual result migration | 2, 5, 6 and 7: distinct persisted shape, baseline inline/fragmented conversion, exact rendering and ownership, completed-but-unsettled recovery and result inspection with the component absent. |
| Full response-control semantics | 2: complete dependency projection, mutation-owned correction/advisory/reserve effects, changed facts, admission failure and lost acknowledgement. |
| Staging and shared cleanup ownership | 2 and 4: ownership from first fragment, superseded attempts discoverable, purge restart and shared final text retained until both owners release it. |
| One-time migration preserving functionality | 5 and 6: full equality/reference inventory, live migrated-data journeys, old copies retained on failure. |
| Convex Agent retirement without a legacy reader | 7 only after 6: explicitly byte-qualified obsolete-copy removal, package/schema/code cleanup, functional checks with component absent. |
| Retained-preparation and ancestry measurement gap | Baseline before changes; 6 before/after evidence or explicit unresolved acceptance gap. Synthetic tests remain labelled synthetic. |
| Delivered Sources progress, consultation replay, native completion and profiles | Preserve historical completion evidence; rerun affected suites in 2, 3 and 7. Do not reintroduce retired versions or redo delivered implementation. |
| Current documentation and paid qualification boundary | 7: accurate TECH/ROADMAP and supersession notes; no live semantic acceptance inferred from these checks. |

## Open Questions and Execution Prerequisites

No new storage or migration direction is needed. The approved architecture is preserved; the user-requested corrections to review 44 are now specified in both documents. No independent recheck or runtime acceptance of this corrected revision is claimed. The exact deployment/inventory and complete retained measurement graphs must be established during implementation preparation. They are not assumed available, and a missing prerequisite cannot be marked passed. Data migration and destructive retirement remain separate recorded steps; this document revision executes neither.
