---
type: structure-outline
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
status: proposed
---

# Implementation Outline: Legacy Retirement and Agent Version Resolution

Implement the [approved technical design](36-tdd-legacy-retirement-version-resolution.md) in five testable phases. Remove the obsolete launch and backfill APIs first, establish shared admission rules before deleting executors, then close the remaining corpus-review producers. This outline carries both amendments from the [second Oracle review](38-oracle-review-legacy-retirement-program-design.md); it does not reopen the approved scope or authorize implementation.

## Desired End State

The existing agent catalog owns effective definition selection: governing persisted pin, otherwise authorized comparison binding, otherwise explicitly named current definition. Conversation creation, turn admission, mission admission and child handoffs consume that rule. Request replay and objective reuse validate the retained contract and return its identity without authorizing continuation or creating work.

Retired mission backends and corpus-review execution cannot start new work. Current Pi execution, AI SDK one-shot documentary checks, conversation storage, Sources preparation and authorized recovery remain supported. Historical records remain inspectable and cancellable. Preserve all registered definitions and required profiles, the historically inventoried Workbench 4 conversations and Sources 4 contract, and the Workbench 8/Sources 6 and Workbench 7/Sources 5 comparisons. No migration, purge, dependency removal or archive cleanup is included.

## Implementation Overview

- [ ] Phase 1: Keep confirmation and Start as the only research-launch contract
- [ ] Phase 2: Centralize definition selection and validate retained replay
- [ ] Phase 3: Remove obsolete mission executors while preserving current generation
- [ ] Phase 4: Remove corpus-review orchestration and its remaining producers
- [ ] Phase 5: Verify the combined candidate and record activation readiness

```text
Launch/backfill cleanup
  → shared selection + retained replay + retired-backend admission refusal
  → old mission-driver deletion
  → old corpus-review producer/driver deletion
  → combined verification and deployment-specific activation decision
```

Every phase ends with runnable candidate code and focused evidence. Phase 2 may retain unreachable old driver implementations until Phase 3; it must not retain a callable bypass around retired-backend admission. Candidate completion and deployment activation are separate states.

## Execution Preconditions

Before production edits, recheck branch, HEAD, user changes and development watcher state. The outline was prepared on the recorded revision with a clean tracked tree; no deployment inventory was refreshed. Read the repository's TDD skill for implementation: characterize preserved behavior before refactoring and observe RED through real consuming boundaries for intentional admission/refusal changes. Use real Convex modules/schema/component adapters; mock only external or nondeterministic boundaries.

A watcher must not publish intermediate deletions or temporary source rehearsals. Use the primary checkout when it cannot publish those edits; if publication cannot be controlled within existing authority, prepare the candidate in a non-watched checkout. Do not implicitly stop services or start another backend. Deleting deployed targets requires zero remaining execution, retry, completion or cancellation dependency on each target, including suspended Workflows and callbacks. Keep old producers from adding dependencies between inspection and activation using an authorized procedure. An unknown dependency defers that batch's activation, not independent candidate implementation.

Keep generated references current through the installed Convex generator. `pnpm exec convex codegen --typecheck disable` is a conditional generation command, not an offline-test command: the installed CLI resolves deployment credentials and enters `withRunningBackend`. Establish the intended local target and permitted lifecycle behavior before running it; do not substitute a remote target or start a service implicitly. Never hand-edit generated APIs. Record a generation/access blocker if the established generator cannot run safely.

## Phase 1: Keep confirmation and Start as the only research-launch contract

This removes two independent obsolete surfaces without changing version selection. Fresh calls to the old public launch already refuse; deletion also intentionally ends its historical reservation replay.

### Change Outline

```diff
 convex/researchLaunch.ts
-  confirmAndStart public action
-  confirmAndStartReserved(..., framingOnly)
+  createFramingDossier(...) internal mutation
 convex/framing.ts
   confirmCompany → createFramingDossier → initializeFraming
   startResearch → existing atomic quota/slot/Sources admission
 convex/workflowControls.ts
-  startReserved
 convex/adminOperations.ts
-  previewRunPurposes / migrateRunPurposes / exclusive migration guards
 convex/domain/runPurpose.ts
-  classifyRunPurpose
   runPurposeValidator / RunPurpose remain
```

Keep the framing creator in its current owner. Preserve preflight ownership, consumed preparation replay and validated manual references; a reservation key belonging to a non-framed dossier must refuse. Remove `framingOnly` and obsolete branches. Point `CoveragePreset` in `src/lib/presentation/research-copy.ts` and the launch test helper's argument type at `framing.confirmCompany`.

Move the `startReserved` withdrawal regression to current Start and resume boundaries, retaining the separate retry guard. Seed explicit purposes in workspace-separation tests; remove only migration-specific assertions and fixtures that delete the now-required field. Preserve technical-data isolation and human quota accounting. Refresh generated references after exports change under the preconditions above.

### Validation

#### Automated Verification

- [x] Run the existing launch/framing/workspace suites before changes to characterize preserved behavior. Add failing tests for uncovered current-boundary refusal or rollback requirements before implementing them.
- [x] Assert confirmation creates framing without research or analysis consumption; Start charges once on replay; missing configuration and concurrent/withdrawn starts leave quota and ownership correct. Preserve manual-reference and preflight ownership, expired/foreign preparation refusal, and reservation collision checks.
- [x] After removal, verify the retired exports and executable callers are absent; retain current boundary assertions instead of tests requiring old replay.

```sh
pnpm exec vitest run src/__tests__/convex/research-runs/{research-launch,framing,run-workspace-separation}.test.ts --maxWorkers=2
pnpm typecheck
rg -n 'confirmAndStart|startReserved|classifyRunPurpose|previewRunPurposes|migrateRunPurposes' convex src scripts --glob '!scripts/evaluations/archives/**' --glob '!scripts/evaluations/source-selection/runs/**' --glob '!scripts/evaluations/source-selection/fixtures/**'
```

The search should find no active references; classify any historical fixture/report matches explicitly. A no-match `rg` exit code of 1 is expected.

#### Manual Verification

Review the removal diff against current confirmation/Start assertions: no quota, ownership or validated-reference requirement may disappear with the old API. Activation of `startReserved` deletion requires the target dependency check; this phase does not authorize cancelling queued work.

## Phase 2: Centralize definition selection and validate retained replay

Deliver the single version-selection owner and the complete admission policy before deleting old implementation modules. Keep this as one cohesive phase because mission lookup, Sources replay and backend refusal must agree at every entry point.

### Change Outline

Extend `convex/execution/agentCatalog.ts` with the approved `resolveAgentDefinition(AgentDefinitionSelection): AgentDefinition` interface. Its `new`, `conversation` and `mission` alternatives accept authoritative context; the conversation and mission alternatives use generated document types. Implement through existing exact lookup, keep named current bindings in `definitions()`, and delete `defaultDefinitionVersionForBackend`. Do not add another version map, registry, persistence layer or wrapper around already-correct exact lookups.

| Owner | Change |
| --- | --- |
| `execution/conversations.ts` | Use the selector for creation, turn admission and queue eligibility; resolve before claiming ownership. Preserve storage-only fixture conversations; missing/mismatched required native pins refuse. |
| `qualificationAgentMethods.ts` | Keep comparison bindings and campaign authority here. Callers obtain validated comparison versions even when a saved pin takes precedence. |
| `execution/missionData.ts` | Add `missionObjectiveKey(scope: AgentScope, conversationTurnId?: Id<"agentConversationTurns">): string`. No runtime import from `domain/sources`. |
| `execution/agentDefinition.ts` and five domain definitions | Remove `objectiveKey` from `initialState`; keep domain validation, state and obligations. Definitions are `workbenchAgent`, `sourcesAgent`, `savedMaterialInspection`, `conversationValidation`, and `executionValidationAgent` under `convex/domain/`. |
| `domain/sources.ts`, `qualificationInitialFixtureSetup.ts`, `sourcesMission.ts` | Replace `sourcesMissionKey` and the admission literal with the shared constructor; preserve request/event names and `readSourcesMission` lookup. |
| `execution/executionProtocol.ts` | Add `requireSupportedMissionBackend` for new and retained admission. Omitted new backend uses the current Pi default; absent retained backend/runtime must not imply Pi. Preserve historical schema values and typed `generation_backend_unknown`. |
| `execution/missions.ts` | Identify retained work before selecting a candidate; enforce retained support and identity checks on replay/reuse. Reject retired backend resume before recovery patches, model pinning, cancellation or scheduling. |
| `execution/handoffs.ts` | Preserve parent operation grants, child ownership and return limits. Admit the child's ID/scope through the shared policy; remove executable historical-backend fallback after checking supported parent execution. |

Characterize and preserve these exact objective bytes: `workbench`, `conversation`, `sources:${preparationId}`, `saved-material:${corpusRevisionId}`, and `validation:${JSON.stringify(values)}`. Preserve array ordering and append `:${conversationTurnId}` only when supplied. No migration or new index is needed.

```text
missions.start, one mutation
  validate request/scope shape and dossier access; correlate conversation/turn
  find by run + request key, otherwise run + stable objective key
  retained mission found
    validate scope/agent/generation/owner and replay-specific identity
    refuse retired backend; resolve retained pin
    validate pinned scope and applicable run/turn/comparison authority
    preserve blocked-objective refusal; return ID without writes or dispatch
  no retained mission
    resolve conversation pin / authorized comparison / named current
    validate support, scope, authority, resources and ownership
    initialize, insert, claim turn and journal atomically

sourcesMission.start, existing completion event
  missions.start with requested scope/generation and retained completion event
  return validated mission ID and same event, without new event or resume
```

Request replay preserves completion-event and explicit-backend identity checks. Objective reuse can accept a different request key but cannot change scope, agent, turn, generation, explicit backend compatibility or unfinished/completion ownership. Keep `reattach` as the explicit completion-rebinding operation. Do not run full progression authority merely to return an existing ID: supported completed-result reuse remains valid. Resume separately enforces progression authority.

### Validation

#### Automated Verification

- [x] Add `src/__tests__/convex/execution/agent-definition-selection.test.ts` for the cross-entry matrix; extend existing owning suites for local behavior. Characterize keys through real admission before extraction, then keep them green. For current-default tests use `seedWorkbench`'s `definitionVersion: null` argument position so its default historical version 5 does not hide current selection.
- [x] Cover confirmation, first turn, queue admission, direct mission creation and child handoff: named current, saved pin over authorized comparison, both comparison arms, child identity, absent/mismatched/unknown pins, invalid campaign authority even with a saved pin, and storage-only conversation behavior.
- [x] Observe RED before fixing request replay/objective reuse and Sources' existing-event shortcut. Cover supported and completed reuse, blocked objective, identity conflict, stale generation, invalid authority, retired/unknown backend and missing retained runtime. Assert returned IDs/pins/events and unchanged relevant records, ownership, schedules, reservations and receipts; successful replay must not resume.
- [x] Run two nonpublishing source rehearsals, recording pass/fail and restoration: select a lower named current Workbench binding while a higher registration remains, then restore maximum-version selection and observe the same consuming test fail; independently narrow only the current definition's scope validator while the retained definition remains valid, verify both replay paths succeed, then restore candidate-first validation and observe both fail. Restore every temporary change before normal checks. Do not mock internal selection or introduce a production override.

```sh
pnpm exec vitest run src/__tests__/convex/execution/{agent-definition-selection,missions,workbench-continuity,retained-workbench-control,qualification-method-comparison,operation-conformance}.test.ts src/__tests__/convex/sources/sources-mission.test.ts --maxWorkers=2
pnpm typecheck
```

Adapt tests whose sole expectation is executing a retired backend to the approved refusal contract in this phase; port shared-behavior assertions first. Keep the regression battery runnable before proceeding to driver deletion.

#### Manual Verification

Trace every selection caller to the catalog and every comparison permission check to its existing owner. Review transaction ordering for rollback and confirm the Sources shortcut has no bypass. Verify rehearsals changed independent definition objects, retained higher registrations and restored source hashes/diffs; different version numbers alone do not falsify candidate-first replay.

## Phase 3: Remove obsolete mission executors while preserving current generation

With retired admission covered, remove its unreachable implementations and prove that current generation, history and cancellation survive.

### Change Outline

| Owner | Treatment |
| --- | --- |
| `execution/missions.ts`, `execution/missionWorkflow.ts` | Delete non-Pi workflow dispatch and the old driver, including callback targets only when activation dependencies permit. |
| `integrations/agentBackends.ts`, `execution/invokeAgentModel.ts` | Remove backend implementations, obsolete `invoke` action and fallback resolution. Keep `invokeControlledGeneration`; make its Pi-supplied backend required. Preserve auxiliary work, provider observations, retained responses and billing. |
| `execution/executionProtocol.ts`, `execution/invocationLifecycle.ts` | Rename `LEGACY_AGENT_BACKEND` to `AI_SDK_BACKEND` for current one-shot calls; keep persisted `{ id: "ai-sdk", version: 1 }` identity unchanged. |
| `integrations/modelTransport.ts`, `integrations/agentStorage.ts` | Remove `invokeDeferredAgentTurn` and exclusive old storage preparation only after tracing consumers. Preserve one-shot streaming and Convex Agent chat/message storage. |
| `execution/cancellation.ts`, `execution/missionHistory.ts` | Preserve authorized cancellation and inspection independent of supported-backend admission; no definition pruning. |
| `scripts/check-execution-boundaries.ts`, generated APIs | Update removed-owner references through their owning mechanisms; no stale executable references. |

Move tests of shared generation/settlement away from obsolete executor setup before deleting it. Remove only tests that require the retired execution contract; retain old/new operation acknowledgement, receipt replay and billing-idempotency assertions.

### Validation

#### Automated Verification

- [x] Run focused suites before and after deletion; extend current Pi or one-shot consuming boundaries for shared behavior previously covered only through old drivers.
- [x] Verify retired start/replay/resume refusal has no new work, while cancellation fences late effects, settles outstanding requests and releases ownership. Read retained journals without dispatch.

```sh
pnpm exec vitest run src/__tests__/convex/execution/{agent-definition-selection,pi-mission,pi-recovery,one-shot,model-action,cancellation,mission-history,workbench-operation-effects}.test.ts --maxWorkers=2
pnpm typecheck
node --experimental-strip-types scripts/check-execution-boundaries.ts
rg -n 'missionWorkflow|agentBackends|invokeDeferredAgentTurn|LEGACY_AGENT_BACKEND' convex src scripts/check-execution-boundaries.ts
```

#### Manual Verification

Trace `piMission → invokeControlledGeneration` and `executePreparationModel → documentaryControl → invokeOneShot` after removal. Review historical journal/schema compatibility and callback/cancellation dependencies. Passing local tests does not establish that deleted deployed targets are unused.

## Phase 4: Remove corpus-review orchestration and its remaining producers

Remove all obsolete producers together with the preparation workflow, preserving shared preparation primitives and current Sources recovery.

### Change Outline

```text
researchWorkflow.run
  authorized reattachSources → rebind existing completion and await handoff
  otherwise require supported Sources envelope before external work
  current company revalidation / planning / discovery / Sources / handoff

Retire
  sourcePreparation.startReviewPreparation / startForReview
  sourceSelectionProposalActions old rebuild/recovery/direct-discovery fallback
  sourcePreparationWorkflow and old no-envelope research loop
  workbench legacy instruction delivery / sources manual-review branch
  sourcePreparationEvaluation.start and preparation-study CLI execution

Retain in existing owners
  Sources claimForDiscovery / intake / instructions / qualification / persistence
  pause, resume, renewal, settlement and runRecovery reattachment
  historical study inspection and offline artifact analysis
```

Reject unsupported workflow entry shapes before company revalidation or other external work. Do not require a new envelope on authorized `reattachSources`. Delete obsolete branches within shared modules rather than deleting `sourcePreparation.ts` wholesale. Retire the study CLI's execution before catalogue/provider access, seeding or copying; never redirect it to a different experiment. Remove exclusive study creation helpers after consumer inspection, preserve inspection, and leave the retained method comparisons intact.

Port shared primitive assertions from `src/__tests__/convex/workflows/source-preparation-*.test.ts` to the real current Sources boundaries before removing old orchestration tests. Extend `src/__tests__/benchmarks/preparation-study.test.ts` for early CLI refusal and retained offline behavior. Refresh generated API references under the same generation preconditions.

### Validation

#### Automated Verification

- [x] Observe failing tests for unsupported no-envelope workflow entry and retired shared-boundary/CLI execution before implementing refusal. Assert no provider receipts, external requests, reservations, new workflow/event ownership or study fixture writes, as applicable. External-boundary observation supplements persisted state; internal spy counts are insufficient.
- [x] Preserve current claim/start, manual references, instruction outcomes, pause/resume, time-limit renewal/settlement and envelope-less recovery with real collaborators. Verify retained study/history reads and the absence of retired executable references.

```sh
pnpm exec vitest run src/__tests__/convex/sources/{sources-mission,sources-instructions,manual-source-intake,manual-source-submit,sources-pause-admission,sources-time-limit,sources-reopen,sources-completion,source-preparation-budget}.test.ts src/__tests__/convex/research-runs/{research-launch,framing}.test.ts src/__tests__/benchmarks/preparation-study.test.ts --maxWorkers=2
pnpm typecheck
rg -n 'sourcePreparationWorkflow|startReviewPreparation|startForReview|sourcePreparationEvaluation\.start' convex src scripts --glob '!scripts/evaluations/archives/**' --glob '!scripts/evaluations/source-selection/runs/**' --glob '!scripts/evaluations/source-selection/fixtures/**'
```

Add new entry-shape coverage to an existing workflow suite or a focused file under `src/__tests__/convex/workflows/`, and include that file in this phase's executed command. Do not keep obsolete workflow tests merely to make the listed command look unchanged.

#### Manual Verification

Trace every old producer through its surviving boundary and inspect fallback branches, not just exported names. Confirm invalid workflow entry fails before I/O, while current reattachment retains its authority checks. Classify search matches as executable dependencies, deliberate refusal evidence or frozen history; absence of a name alone does not prove deletion closure.

## Phase 5: Verify the combined candidate and record activation readiness

Finish reference consistency, generated-profile verification and the full repository contract once the cross-cutting changes stabilize. Report candidate correctness separately from deployment readiness.

### Change Outline

Update `context/TECH.md`'s historical executor guarantee and `docs/ROADMAP.md`'s execution/source-review capability passages to the approved retained-use policy and actual delivery state. Search historical designs for superseded execution claims and add dated supersession notes where needed, preserving original evidence. Keep `PRODUCT.md` unchanged; tracked references must not link to local artifacts.

Verify input profiles through their owner in `src/__tests__/convex/execution/pi-input-capacity.test.ts` and `integrations/piModelProfiles.ts`. Preserve registered definitions and retained profile keys. If the generator detects a justified artifact change, regenerate with its update flag, review the diff and rerun without that flag. Do not manually edit generated JSON or run paid qualification to validate this refactor.

### Validation

#### Automated Verification

- [x] Format changed task files once with `pnpm exec biome format --write` followed by the explicit path list; use focused `biome lint` during implementation. Finish generated API updates before final typechecking.
- [x] Verify native profiles and retained contracts with the commands below. Regenerate only when required by the owner check.

```sh
pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
# Only when regeneration is required:
UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
# Recheck after regeneration without UPDATE_PI_INPUT_PROFILES.
pnpm exec vitest run src/__tests__/convex/execution/{workbench-continuity,retained-workbench-control,qualification-method-comparison,operation-conformance,workbench-operation-effects,pi-recovery,one-shot}.test.ts src/__tests__/convex/sources/sources-reopen.test.ts --maxWorkers=2
pnpm check
```

The final `pnpm check` is justified by changes spanning generated APIs, workflow producers, execution, tooling and frontend types; it includes documentation, design, type, lint, format, test and build checks. Do not repeat it between routine edits. Rerun only checks invalidated by later changes. Record exact RED, GREEN and falsification commands/outcomes, not just test totals, and verify temporary source changes were fully restored.

#### Manual Verification

- [ ] Review reference changes for accurate ownership, preserved requirements and no duplicated policy. Audit the final diff for unapproved definition pruning, dependency changes, silent version fallback or new shallow abstractions.
- [ ] For each deployment intended for activation, inventory pending scheduled targets, suspended/running Workflows, retries, completion/cancellation callbacks, unfinished operations and continuing missions. Record target-by-target dependency evidence and how producer races are prevented until activation. Do not infer readiness from all-Pi mission counts.
- [ ] When publication is authorized and the gate passes, verify successful application of the final code through the established watcher or explicitly intended `pnpm convex:sync --url http://127.0.0.1:<verified-port>` procedure. Exercise the changed deployed boundaries with authorized deterministic checks and retained-history reads; no real conversation migration or paid qualification is implied. If publication/access is unavailable, mark runtime verification and the affected activation pending.

The final handoff lists removed entry points, retained contracts, checks actually run, documented limitations, deployment dependency evidence and any deferred activation. Keep existing research and design evidence immutable. Neither this outline nor a green local aggregate authorizes commit, remote deployment, data cancellation or deletion.

## Open Questions

No scope or phase-order decision remains unresolved. Deployment-specific dependencies, the blocked Sources 4 mission's recoverability and generator access remain factual activation/execution prerequisites; inspect them in the intended environment and defer only affected work if unavailable. The November 22 inventory and research's 171 passing tests are dated evidence, not current readiness.

## Outline Verification

This document is a proposed implementation sequence, not delivered code. Source inspection confirmed the recorded baseline, admission ordering, Sources replay shortcut, obsolete producers, actual test paths and package scripts. On November 24, 2026, `pnpm docs:check` passed with 76 Markdown files, 449 local links and zero errors; the existing TECH word-count warning remains advisory. Because that checker excludes local artifacts, a separate check verified this outline's links, balanced fences, five synchronized phase headings/checklist items and test-command paths (except the explicitly proposed new selection suite). Prose and visual review kept the approved design as the contract owner and used focused ownership/control-flow views for the sequence. The tracked working tree remained clean. No application tests, generator, deployment inventory or live provider work ran while preparing the outline.

## Implementation Evidence

The code changes for all five phases are in the candidate. The candidate removes the retired launch mutations, run-purpose backfill, model executors, corpus-review producers, and preparation-study execution. The named definition catalog serves new admission, and retained mission replay validates the saved binding and completion owner before returning the original ID. Historical cancellation, inspection, one-shot generation, and conversation storage retain their existing owners.

- The Phase 1 launch, framing, and workspace suites passed 40 tests before changes and 36 after the first removal. The final launch and workflow tests also exercise SEC identity validation and retirement of no-envelope execution.
- Mission admission reproduced acceptance of missing runtime, a mismatched objective backend, and an omitted completion event on unfinished work. Sources replay reproduced returning the event without validating the mission. The mission and Sources tests passed after correction.
- The [lower named binding](legacy-retirement-named-current-lower.log) and [retained scope](legacy-retirement-retained-scope.log) rehearsals passed. [Maximum-version selection](legacy-retirement-maximum-version-falsification.log) and [candidate-first validation](legacy-retirement-candidate-first-falsification.log) failed the consuming tests. All temporary source and test edits were restored.
- The [no-envelope RED](legacy-retirement-no-envelope-red.log) reached SEC I/O before the fix. The [instruction RED](legacy-retirement-instructions-red.log) returned the old declined preparation result. The [study RED](legacy-retirement-study-red.log) reached artifact loading. The current entry tests pass and assert the persisted state or output boundary.
- Two final review batches checked caller-visible ownership. The [completion-owner RED](legacy-retirement-completion-owner-red.log) showed an unfinished mission could be returned without its event. The [analyst Resume RED](legacy-retirement-sources-resume-red.log) showed a retired backend could advance the generation and claim the slot before refusal. The [final Resume run](legacy-retirement-final-resume.log) passed 50 tests across backend admission, missions, recovery, and Sources. The broader [focused run](legacy-retirement-focus-final.log) passed 152 tests.
- The [native input profile check](legacy-retirement-profile.log) passed 13 tests without regeneration. The [offline API generator](legacy-retirement-offline-api.cjs) invoked the installed Convex 1.47.0 root declaration generator and reproduced the prior declaration byte for byte before deletion. Regeneration removed only the five retired module imports and map entries. The configured local backend remained stopped.
- The technical contract now describes named selection, retained history, and supported Sources entry shapes. The roadmap keeps activation pending. The historical code link and study instructions are traceable to the pre-deletion Git revision. Both documentation surfaces point to the current Sources contract.

Deployment activation is pending each target's inventory of scheduled functions, suspended workflows, callbacks, unfinished operations, and continuing missions. The candidate was verified through local source and deterministic tests. The stopped local deployment and the retained Sources v4 mission were not inspected or changed.

The follow-up TDD check ran the candidate's admission tests against the pre-change revision in an isolated checkout. The [baseline run](legacy-retirement-additional-baseline.log) admitted the retired backend, while three pin cases already passed and serve as characterization evidence. The [settlement regression](legacy-retirement-model-settlement.log) preserves shared receipt rollback and replay accounting through the real Pi invocation and ledger mutations. A response one byte over the retained payload limit leaves the receipt, invocation and budget unchanged. The next valid observation settles once across replay. [Swallowing the retention error](legacy-retirement-settlement-falsification.log) made the regression fail in a disposable checkout. The candidate source was untouched by that probe.

The [final repository check](legacy-retirement-final-check.log) exited zero. It passed 237 protocol tests and 3,396 Vitest tests across 345 files, followed by the production build. The final typecheck and diff whitespace check also passed. Documentation reported its advisory TECH length warning, and the existing lint warnings remain visible in the aggregate log.
