---
type: structure-outline
flow: tdd
status: ready-for-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
---

# Sources State, History and Completion: Implementation Outline

Implement the [approved technical design](29-tdd-sources-harness-efficiency.md) through five independently verifiable phases. The [request](22-request-sources-harness-efficiency.md), [research](28-research-sources-harness-efficiency.md) and [Oracle review disposition](30-review-sources-harness-efficiency.md) establish scope and evidence. Oracle found no remaining architectural blocker; native settlement, projection read cost and model-profile refresh remain implementation obligations.

## Desired End State

Sources and Workbench see current documentary preparation separately from final retained membership. Requested historical content reaches the native transcript intact through efficient pages, including continuations issued before this change. Structured agents submit completion through a declared Pi tool; Convex accepts the result once, and Pi settles or reports an explicit recovery failure. Historical missions keep their pinned interface and authority.

This outline is implementation preparation, not authorization to edit production code or start qualification. Documents 24–27 retain the separate generation-resilience workstream. No dependency change, provider tuning, new completion table, parallel cache, custom generation loop or restored `repetition_stop` belongs to this work.

## Implementation Overview

- [ ] Phase 1: Show truthful preparation state without breaking historical consultation.
- [ ] Phase 2: Deliver complete history pages through the native transcript.
- [ ] Phase 3: Complete structured missions once and recover their native tail.
- [ ] Phase 4: Activate versioned definitions with verified model profiles.
- [ ] Phase 5: Verify the combined path and record delivered capability.

```text
1. Current state + consultation compatibility + profile preservation
   -> 2. History selection + page sizing + native delivery
   -> 3. Native completion + retained disposition + crash recovery
   -> 4. Default versions + stored profile refresh
   -> 5. Combined verification + current documentation
```

The order keeps one integration line in the primary checkout. The first two corrections are independently useful, but both change native input contracts. Preserve profile compatibility at the first such change, then regenerate only when a later phase changes measured inputs. Register the new completion definitions for explicit-version tests in phase 3; switch defaults only after recovery passes in phase 4. This uses the existing catalogue, without a rollout framework or temporary feature flag.

## Execution and Evidence Rules

Before implementation, recheck branch, HEAD, user edits, installed SDK tuple and available definition versions. Preserve a baseline copy of `convex/integrations/piInputProfiles.json` and retained measurement inputs under this task's validation directory. Keep raw historical evidence immutable. If a local watcher is active, inspect its identity with `pnpm dev:status --json`; follow the existing worker admission hold/publish/release procedure in [TECH](../../../context/TECH.md#local-development) before worker-protocol changes. Never start a second backend to verify a push.

Use test-first regressions at the existing registered Convex and native Pi boundaries. Record the intended failing assertion before changing behavior; setup failures do not count as RED. Characterize behavior before refactoring shared reads. Mock external generation or HTTP only; execute the real projection, dispatch, adoption, storage and recovery owners. For pagination arithmetic, derive exact-fit and overflow expectations independently and falsify an off-by-one boundary once before restoring it. Keep tests under `src/__tests__/`, using existing setup modules.

Each phase records commands, RED/GREEN evidence, changes and unresolved limits in one implementation record. Run the smallest affected test during edits, then the listed phase checks. Native/provider fixtures prove execution mechanics, not model usefulness. No checks below have been run as part of drafting this outline; prior results remain dated evidence in the research.

## Phase 1: Show truthful preparation state without breaking historical consultation

Deliver one compact current-preparation projection to Sources, Workbench and `consult_run_state`. Separate action applicability from an actual mission stop. Include consultation versioning and profile preservation in this phase because the new result schema changes pins and serializer identity immediately.

### Change Outline

| Existing owner | Change |
| --- | --- |
| `convex/domain/sources.ts`, `sourceReviewReads.ts`, `sourcesContracts.ts` | Derive progress from current capture identities, matching qualifications, effective contribution restrictions and admitted reading references. Reuse `tallyDocumentaryContributions(...).effectiveUses` and its four-category validator. Share loaded records and one transaction-local reader. |
| `convex/domain/researchState.ts`, `researchStateContracts.ts` | Compose optional versioned `sources.progress`; every current successful projection supplies it. Historical absence remains unknown. Final `retainedDocuments` still comes only from handoff. |
| `convex/domain/sourcesAgent.ts`, `workbenchContext.ts` | Supply shared loaded preparation, capture and contribution facts to detailed and compact projections. Extend `sourcesTaskObservations` to consume that reader. Do not hydrate passages for summary counts. |
| `convex/execution/researchControl.ts`, `approvalCatalog.ts` | Preserve the actual readiness block before testing renewal applicability; ordinary running work must not appear to require human approval. Transaction-time controls remain authoritative. |
| `convex/execution/commonOperations.ts`, `operations.ts`, result validators | Advance `consult_run_state` to v3. Reuse completed-old-version replay; pending v2 returns `operation_version_conflict`; fresh v3 gets a progress-aware pin. Preserve historical successful bytes after authority checks. |
| Existing profile generator in `src/__tests__/convex/execution/pi-input-capacity.test.ts` | Preserve required baseline keys for unchanged historical serialized inputs under the same SDK tuple; measure changed contracts under new keys. Reject incompatible carry-forward rather than inventing estimates. |

```text
Preparation + capture identities + controlled contributions + readings
  -> existing domain rules, shared loaded records and reader
       -> detailed Sources / Workbench material
       -> research.sources.progress
            -> current required state and consult_run_state v3
```

The progress shape remains the approved `version`, `handoff`, `captures`, `qualifications` and `readings` contract. `referencesComplete` describes the existing reading window, not a fabricated total. Missing/corrupt dependencies remain explicit failures, never zero work.

### Validation

#### Automated Verification

- [x] Extend `research-state.test.ts` through registered context and operation consumers: active captured/read/qualified material with pending handoff; all four effective-use categories, restriction changes and obsolete-capture qualifications; incomplete reading window; true human pause versus unavailable action; actual stop; partial/no-material handoff; historical missing progress; changed summary pins and reuse.
- [x] Test completed old consultation byte equality, pending-old refusal, fresh v3 admission and revoked authority separately. Preserve slot, paid-work and human-prerequisite enforcement through existing control tests.
- [x] Measure before/after actual logical rows and serialized row bytes returned by real database reads for Sources context, Workbench context and standalone consultation on retained preparation data. Include reads outside `SourceReviewReads`; keep underlying reads real. Record capacity refusals. These measurements do not establish physical Convex billing or deployed latency.
- [x] Test baseline profile-key retention, new schema keys and explicit SDK mismatch refusal through the consuming serializer/lookup boundary before regeneration.

```sh
pnpm exec vitest run src/__tests__/convex/execution/research-state.test.ts src/__tests__/convex/sources/sources-workspace.test.ts src/__tests__/convex/workflows/framed-research-control.test.ts src/__tests__/convex/execution/approvals.test.ts --maxWorkers=1
UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
```

#### Manual Verification

Review one retained running preparation across all three model-facing consumers. Check that current readings and restricted contributions do not imply final selection or truth. Compare measurement records and explain any additional reads; compact JSON alone does not close the projection-cost watch. Exit only when the shared projection, old receipts and measured read behavior are accounted for together.

## Phase 2: Deliver complete history pages through the native transcript

Correct selection, sizing and delivery as one slice. A larger retained page is not delivered correctly if Pi truncates its rendered success wrapper.

### Change Outline

| Existing owner | Change |
| --- | --- |
| `convex/execution/history.ts` | Resolve authenticated frontier/target during admission and reading; retain them on new continuation pins. Resolve old predecessor chains with authority and consistency checks. Fit actual serialized pages to the common result capacity. |
| `convex/execution/journal.ts` | Read an authorized range from inline or fragmented immutable text, without validating offsets against the obsolete 4,000-unit width. Load candidate bytes once for sizing; retain hash and membership checks. |
| `convex/resourcePolicy.ts` | Remove the unsupported 48 KiB history ceiling. Use `MAX_OPERATION_RESULT_BYTES`; retain distinct event/row/storage bounds and move the conversation scan-byte value to this owner. Remove both fixed mission and conversation content splits. |
| `convex/execution/agentDefinition.ts`, `convex/integrations/modelInput.ts`, `piMission.ts` | Derive shared native output allowance from canonical value capacity plus renderer overhead. Audit every registration and after-tool renderer, including refusal output and later completion acknowledgements. |
| `convex/execution/commonOperations.ts`, `missionHistory.ts` | Make the operation description accurately distinguish the automatically supplied current state from requested historical content. Preserve the model's choice of targeted or chronological retrieval. |

```text
issued cursor -> validate retained ancestry -> frozen frontier + target + offset
  -> immutable candidate range
  -> complete event fits? return it
  -> otherwise largest Unicode-safe prefix fitting the full JSON envelope
  -> retained receipt -> rendered success wrapper -> identical Pi transcript
```

Legacy ancestry must reject cycles, conflicting frontiers and already-diverged fragments. A missing target on an old intermediate pin does not authorize chronological browsing. New resolved pins shorten later lookup without rewriting old receipts. Test the full event with its terminal null cursor first; use actual continuation overhead only when splitting. A target read ends at that event. Keep conversation publication frontier/database cursor semantics and the existing one-message selection. If even one complete character cannot fit, return explicit capacity failure.

### Validation

#### Automated Verification

- [x] Before the fix, retain the existing synthetic history measurement with `HARNESS_PERF_OUTPUT`; also replay the immutable real traversal payloads identified in the research. Add real-data replay at the same owning boundary, with source identity and hashes recorded. Do not overwrite the archives or claim synthetic data is production traffic.
- [x] Test old inline and fragmented cursors, frozen chronological traversal, and at least three pages of a cross-mission targeted context event with a colliding mission sequence and old intermediate pins. Verify exact reconstruction, fragment hashes and next-position consistency; refuse fabricated, foreign, stale, corrupt, cyclic and already-diverged chains.
- [x] Cover ASCII, non-BMP characters and JSON escaping; independently derived exact fit, one-character overflow, terminal-cursor overhead and no-character capacity failure. Preserve source-query and conversation scan-capacity outcomes. Replace the current `measurements.length > 10` expectation with independently justified page/correctness expectations rather than keeping the defect as a test requirement.
- [x] Through actual Pi tool execution, prove JSON validity and equality between retained outcome and native transcript for both history tools above 50 KiB and at 64 KiB plus success envelope. Include noncanonical historical JSON, multiline content, refusal feedback and cursor integrity. Calling Chord `boundOutput` alone is insufficient.
- [x] Re-run the same retained traversals after the fix: compare exact hash, consultations, response bytes, logical rows/bytes and legacy ancestry work. Keep actual capacity failures visible; add no guessed ancestry-depth cutoff.

```sh
HARNESS_PERF_OUTPUT=.agents/artifacts/sources-workflow-no-legacy/validation/history-before.json pnpm exec vitest run src/__tests__/convex/execution/history-read-cost.test.ts --maxWorkers=1
pnpm exec vitest run src/__tests__/convex/execution/mission-history.test.ts src/__tests__/convex/execution/conversation-history.test.ts src/__tests__/convex/execution/history-read-cost.test.ts src/__tests__/convex/execution/pi-native-transport.test.ts --maxWorkers=1
HARNESS_PERF_OUTPUT=.agents/artifacts/sources-workflow-no-legacy/validation/history-after.json pnpm exec vitest run src/__tests__/convex/execution/history-read-cost.test.ts --maxWorkers=1
pnpm resource-policy:check
```

Run the first command before editing, the others after the behavior stabilizes. The existing measurement flag reports the synthetic fixture; extend the suite to retain a separately labelled real-payload report. Regenerate profiles through the phase 1 commands when metadata or instruction changes alter measured inputs.

#### Manual Verification

Inspect the native transcript and restored payload, not only the saved receipt. Report measured traversal savings with their scope; do not equate all historical inspection turns with waste or claim improved model judgment. Exit requires both exact restoration and native delivery.

## Phase 3: Complete structured missions once and recover their native tail

Implement completion submission and terminal recovery together on explicitly selected new definitions. This phase is not complete after a happy-path submission; the persisted domain result must survive a crash before native acknowledgement without another domain effect or paid call.

### Change Outline

| Existing owner | Change |
| --- | --- |
| `convex/execution/agentDefinition.ts`, `agentCatalog.ts`, `context.ts` | Add `completionTransport: "native_tool"`, reject combination with `textCompletion`, reserve `submit_completion`, and project its arguments directly from the pinned completion validator. Update native root/current-state instructions without changing retained text contracts. |
| `convex/execution/executionProtocol.ts`, `invokeAgentModel.ts`, `invocationLifecycle.ts` | Retain `completion_submission` with original call ID/JSON or null for missing call. Correlate and validate original arguments, then use the existing definition completion and correction paths with immutable admitted input. Preserve response-conflict and replay semantics. |
| `convex/integrations/piMission.ts`, `convex/execution/piControl.ts` | Install/refresh the reserved native tool. Its callback reads retained disposition or mixed-round refusal; it never completes the domain again. Accepted `afterTools` finishes the terminal tail without active-state rebuild; refusals continue and pending work uses existing durable waits. |
| `convex/execution/piStore.ts`, `piControl.ts`, `invocationLifecycle.ts` | Carry session-prefixed identity at admission, recovery lookup, worker eligibility and terminal replay. Extend successful settlement marking and existing retry/failure branches to enabled structured missions while preserving writer and authority fences. |
| `convex/domain/sourcesAgent.ts`, `savedMaterialInspection.ts`, `conversationValidation.ts`, `executionValidationAgent.ts` | Add the approved next versions with shared capability and unchanged domain acceptance. Register them for explicit-version integration tests; retain current defaults until phase 4. |

```text
sole submit_completion -> retained original call -> existing Convex finish
  accepted -> one domain result -> native acknowledgement -> terminate
  refused  -> retained feedback -> Pi continues within remaining authority
  pending  -> existing wait/resume
mixed round -> operations execute once + retained completion refusal
  -> results/current state -> model must submit a new sole completion
```

The retained response variant is `{ kind: "completion_submission", call: null | { callId, inputJson } }`. It is a transport record, not another domain schema. Mixed/duplicate completion calls remain ordered operation responses with ordinary invalid-request receipts. Missing original wire arguments remain a transport-integrity failure; SDK repairs cannot become the submitted proposal. Preserve known provider success/cost independently from domain refusal.

Queue pause/pump behavior remains conversation-specific. Cancelled non-conversation sessions remain fenced by `piStore.writer`; failure cannot mark successful settlement. Recovery is tied to mission, session, generation, invocation, call identity and lease, not call ID alone. No new completion record, retry controller or correction-count limit is introduced.

### Validation

#### Automated Verification

- [x] First reproduce the absent native completion declaration or reserved-call refusal through the current native boundary. Then exercise the real new definitions; do not replace internal completion callbacks with mocks.
- [x] Cover valid sole submission with surrounding prose, missing call, malformed original arguments, schema refusal, missing wire arguments, invalid call identity and declaration conflict. Preserve raw output and provider receipts.
- [x] Cover mixed completion before/after operations, duplicate completions, domain refusal followed by valid correction, newly engaged work, durable pending operation, stale instructions, cancellation and exhaustion. Assert real retained effects, not just call counts. Corrections beyond three refused proposals remain possible within authority.
- [x] Inject interruption at generation return, completion-tool execution, acknowledgement and worker close. Reopen and assert one domain result, unchanged accounting/effects and no provider redispatch. Include stale writer, revoked dossier access, cancelled structured-session fence, successful settlement markers, bounded retry exhaustion and permanent failure. Preserve conversation queue behavior.
- [x] Verify shared output handling for completion acknowledgements, and retained structured/text definitions including Workbench replies. Regenerate profiles when new declarations or instructions change measured inputs.

```sh
pnpm exec vitest run src/__tests__/convex/execution/pi-native-transport.test.ts src/__tests__/convex/execution/pi-tool-arguments.test.ts src/__tests__/convex/execution/pi-recovery.test.ts src/__tests__/convex/execution/pi-store.test.ts src/__tests__/convex/execution/pi-deferred-wake.test.ts src/__tests__/convex/sources/sources-completion.test.ts src/__tests__/convex/sources/sources-completion-correction.test.ts src/__tests__/convex/sources/sources-completion-freshness.test.ts --maxWorkers=1
```

#### Manual Verification

Inspect one accepted native trace, one corrected trace, one mixed-round trace and one crash-recovered trace. Establish the execution order from retained identities, persisted result and transcript. Close Oracle's settlement watch only after all listed crash/refusal outcomes run; source inspection or historical tests do not satisfy it.

## Phase 4: Activate versioned definitions with verified model profiles

Make the new interface the default for new missions after phase 3 passes. Preserve already admitted execution and ensure configured routes can resolve profiles for the changed declarations.

### Change Outline

Use the existing catalogue and domain binding helpers. At the recorded baseline, the target defaults are Sources 8, documentary inspection 4, conversation validation 3 and execution validation 3. Recheck version availability before editing. Retain Sources 7, inspection 3, validation 2 and other supported historical definitions explicitly; leave Workbench's text-completion version unchanged. Audit `savedMaterialOperations.ts` and other capability/version enumerations so new agents receive their authorized documentary operations without broadening old authority.

Use the generator preserved in phase 1 and existing `modelInput.ts`, `modelRouting.ts` and `modelConfiguration.ts` preparation/lookup paths. New keys need measured profiles. Additive catalogue changes may keep the catalogue revision unchanged; a configured route reads stored database profiles rather than automatically using the JSON artifact. Verify the existing refresh path in that case as well as a changed revision. Do not silently select another model, change effort, enable paid work or replace admitted pins.

### Validation

#### Automated Verification

- [x] Registry conformance discovers each new definition and its genuine scope. Reject reserved-name collisions and contradictory capabilities; no allowlist bypass. Verify latest defaults, explicit historical resolution and authorized documentary binding.
- [x] Regenerate offline profiles and verify deterministic regeneration. Assert retained old keys for unchanged inputs, measured new keys, explicit SDK mismatch/missing-profile failures and no use of an old estimate for a new schema.
- [x] Exercise the real configuration preparation/refresh and admission path with external metadata mocked, for unchanged additive and changed catalogue revisions. Missing database profiles block explicitly; refresh supplies them without altering selected model/effort or admitted pins. No live model preparation is required.

```sh
UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts src/__tests__/convex/admin/model-configuration.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-default.test.ts --maxWorkers=1
node --experimental-strip-types scripts/check-execution-boundaries.ts
```

#### Manual Verification

Compare the baseline and regenerated profile inventories, separating retained unchanged inputs from new measurements. Review the database-backed refresh outcome and exact historical mission pins. This closes Oracle's profile watch only when the configured route succeeds after explicit preparation and fails honestly before it.

## Phase 5: Verify the combined path and record delivered capability

Verify the assembled behavior, then update current documentation from executed evidence. This phase cannot compensate for an unmet earlier exit criterion.

### Change Outline

Run a combined real-owner scenario: new Sources mission prepares useful restricted material; Workbench observes current progress before handoff; Sources retrieves a long targeted historical observation; a mixed premature completion is refused while its authorized work runs once; a later sole completion passes current domain checks; native settlement resumes after an injected interruption. Assert final membership, preserved restrictions, operation history, provider accounting and transcript. Add this scenario to the existing native/Sources integration suite without another test-only executor.

Update the owning passages of [TECH](../../../context/TECH.md) for current progress, consultation version, history/native envelope capacity, completion interface and terminal recovery. Correct the stale one-correction sentence and any related non-progress-stop claims while preserving the separately bounded Workbench advisory control. Update [ROADMAP](../../../docs/ROADMAP.md) only with verified delivery and remaining qualification limits. Search affected historical designs for superseded descriptions and add dated notes linking to the current owner; preserve original decisions and evidence. Tracked documentation must not link to this ignored task directory.

### Validation

#### Automated Verification

- [x] Run the combined scenario and affected phase suites, including representative retained definitions, operation conformance and unchanged Workbench text publication. Preserve cancellation, stale generation, exact evidence and cumulative accounting assertions.
- [x] Format task files once after behavior stabilizes, then run focused Biome diagnostics on the explicit changed files. Do not format unrelated work.
- [x] Run `pnpm check` once at final integration because this change crosses shared invocation protocols, durable storage/recovery, all structured agent definitions, operation schemas and generated serializer profiles. Announce that transversal reason before running it; do not repeat the aggregate after edits that only invalidate focused checks.
- [ ] If backend files are published locally, verify the successful watcher/manual push after the final edit and exercise the affected native path with an authorized zero-provider fixture. Follow worker hold/release and instance-identity rules. If such runtime verification has not run, report it as outstanding rather than equating typecheck or `convex-test` with deployment verification.

```sh
pnpm check
```

#### Manual Verification

Review the final diff against the approved TDD: one owner per rule, no copied completion schema, no pass-through service, no second state cache, no SDK patch, and no hidden historical rebinding. Review documentation necessity, current ownership, stale statements and preserved requirements. Record each Oracle watch with its executed evidence or explicit remaining limitation. Distinguish deterministic correctness, local publication/runtime verification, measured offline efficiency and unverified live semantic usefulness. A new paid qualification requires a separate bounded mandate.

## Review Findings Coverage

| Review concern | Owning phase and exit evidence |
| --- | --- |
| Native truncation | Phase 2: exact model-visible payload and cursor through real native tool execution, including wrapper overhead. |
| Historical consultation replay | Phase 1: byte-identical completed old receipt, pending-old refusal, fresh v3 and revoked authority. |
| Lost targeted history identity | Phase 2: legacy ancestry and three-page cross-mission target with a colliding sequence. |
| Missing effective-use category | Phase 1: existing four-category tally consumed with current captures and restrictions. |
| Structured terminal settlement watch | Phase 3: four interruption boundaries, cancellation fence, retry/permanent failure and no repeated result/accounting. |
| Projection read-cost watch | Phase 1: before/after logical rows/bytes across the three consumers, including reads outside the reader. |
| Profile preservation/refresh watch | Phases 1 and 4: retained baseline keys, measured new keys and database refresh with both catalogue revision behaviors. |

## Open Questions

None blocks this decomposition. The approved contracts remain unchanged. Actual read costs, native crash behavior, configured-profile refresh and model usefulness require execution evidence; they are not assumed successes or new design decisions. Implementation, publication and qualification status must be recorded separately.
