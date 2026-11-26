---
type: structure-outline
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "168981b3c48a7d20062e39e2a2df71689c1036d4"
flow: tdd
status: revised-after-review
design_source: 27-tdd-generation-resilience.md
design_sha256: "dbb90b8720ca2e0f9b4760046da41e667d1b3583c28e5a8e163f1b436896409a"
verification_source: generation-resilience-design-review/verification/verification.md
verification_sha256: "66af0d6edb3863a11999b13505dfd2aec71bcb12ffe0bc81819bcbe40bd2d3c9"
---

# Implementation Outline: Documentary Examination and Generation Resilience

Implement the [revised technical design](27-tdd-generation-resilience.md) in seven testable phases. Establish the retained-data transition first, correct examination and accounting, then connect early interruption to durable recovery. The [verification record](generation-resilience-design-review/verification/verification.md) establishes current defects and already-working final-result acknowledgement recovery. The [code review](47-code-review-generation-resilience-outline.md) found a missing effective-pause transition; Phase 6 and the owning TDD now specify that correction. The user requested a separate independent performance review. Review verdicts remain attached to their frozen inputs. These revisions are not implementation verification or authorization.

## Desired End State

Sources retains independent useful contributions while restricting only the affected contributions or need associations. An unusable structured generation is retained as diagnostic evidence; the harness continues the same operation only after remote termination is proven and existing authority covers the next attempt. Recovery preserves the input, preparation, work reservation, consumed resources and one-time adoption.

The shared one-shot transport interrupts at 4,096 consecutive JSON whitespace characters outside strings, before application text packing. Native parsing remains authoritative. Final cost and remote termination remain separate facts: missing cost keeps the original financial reservation. Qualification and comparison share the transport/classifier but do not acquire an undeclared durable-operation lifecycle.

The final build contains one current examination contract and scheduling representation. A verified one-time conversion preserves historical outcomes and explicitly missing current examination, then removes replaced executors, validators, fields and converters. No data reset, permanent compatibility path, new retry/budget engine, inactivity duration, provider pin or larger allowance is included.

## Implementation Overview

- [ ] Phase 1: Establish reproducible baselines and conversion preconditions
- [ ] Phase 2: Examine contributions and need associations without a global veto
- [ ] Phase 3: Separate termination from cost and establish correct accounting baselines
- [ ] Phase 4: Interrupt excessive whitespace through the shared structured transport
- [ ] Phase 5: Recover committed results through fenced scheduled execution
- [ ] Phase 6: Continue an interrupted examination across worker lifetimes
- [ ] Phase 7: Convert retained work, retire replaced contracts and verify the complete path

```text
Baseline and transition feasibility
  → scoped examination and current projections
  → terminal evidence and versioned accounting
  → raw-stream counter and pinned policy
  → scheduled epochs and retained-result recovery
  → reconciliation, abandoned-worker closure and authorized replacement
  → target conversion, retirement and combined verification
```

Each phase ends in runnable candidate code with focused evidence. Intermediate phases are development checkpoints, not separate production releases: the agreed result includes examination, detection, recovery and retirement together. Keep live admission on the old unchanged candidate until the controlled transition can complete, or keep the affected target fenced during authorized staging. Do not expose a mixture of old accounting and new classification.

## Execution Preconditions

Recheck branch, HEAD, task documents, user changes and the matching development watcher before edits. The recorded checkout contains concurrent unrelated changes; preserve them. The supplied design hashes identify the inputs to this outline. If code or design has moved, reconcile the affected phase before proceeding rather than executing historical line numbers.

Use test-first changes at existing transport and Convex boundaries. Turn the retained probes into assertions of the required corrected behavior; do not retain their defective outcomes as acceptance criteria. Characterize behavior-preserving scheduling changes first. Only use seam-first plus bounded falsification where the new scheduled continuation boundary does not yet exist. Replace external provider HTTP/DNS or an external RPC acknowledgement after its real commit; keep internal owners, schema, persistence and domain effects real. Record RED/green commands and any temporary falsification, including restored source hashes.

Implementation staging must not let an existing watcher publish incomplete schemas, classifier changes or temporary mutations. Reuse the authorized isolated checkout or an explicitly controlled target lifecycle; do not stop another session's watcher, select another backend or create a second local instance implicitly. Regenerate changed Convex references through the installed generator on the verified target, never by hand. Source implementation, target publication/data conversion and paid qualification remain distinct authorities.

## Phase 1: Establish reproducible baselines and conversion preconditions

Make the failure evidence and the conversion boundary executable before changing interpretation or dispatch. This prevents a later discovery of retained work from forcing a compatibility executor into the final build.

### Change Outline

Use the current [documentary integration suite](../../../src/__tests__/convex/sources/documentary-control-integration.test.ts), [provider billing suite](../../../src/__tests__/convex/integrations/provider-billing.test.ts), [Sources fixture](../../../src/__tests__/setup/sources-mission.ts) and [retained probes](generation-resilience-design-review/verification/probes.test.ts.txt). Extend shared fixture setup only when subsequent tests need the same real scenario; do not create a second harness or copy production functions.

Inventory through existing persistence owners and indexes, with a read-only target report when that target is available and authorized:

| Cohort | Required inventory and transition proof |
| --- | --- |
| Documentary results and handoffs | Original control bytes/hash, qualification identity, recorded effective uses, immutable context observation or import requirement, completed versus unfinished preparation. |
| Preparation and campaign accounting | Authoritative receipt membership, existing buckets/counters, charges/reservations, projection scope sizes and unexplained conservative consumption. |
| Conversations and missions | Pinned definitions, active turns/queue, objective/completion identity, native tail, writer/lease and pending generation/tool checkpoints. |
| External and scheduled work | Started/unsettled calls, lookup claims, owned scheduled jobs/wakes, pending operations and any callback still requiring a replaced contract. |

Seed one integration fixture per conversion cohort in a planned `src/__tests__/convex/sources/generation-resilience-transition.test.ts`. Use native Pi fixtures to establish a safe paused-mission generation boundary; an idle status alone does not prove a settled checkpoint. Record the task-scoped conversion order, admission fence, writer-drain condition and cursor/frontier in implementation evidence. Reuse existing persistence owners rather than adding a generic migration service.

### Validation

#### Automated Verification

- [ ] Characterize current receipt accounting, queued cancellation, final-operation acknowledgement recovery and native append/writer behavior. Re-run the exact narrow filters from the verification record first; expand to these affected files when fixtures change.
- [ ] Reproduce lost acknowledgements after real one-shot/control commits and the abandoned lookup claim as diagnostic evidence, then use opposite expected outcomes in their correction phases.
- [ ] Seed idle conversation, safe paused mission, completed historical handoff and unfinished preparation. Record invariant hashes and identify unsafe pending checkpoints; do not convert them yet.

```sh
pnpm exec vitest run src/__tests__/convex/integrations/provider-billing.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/execution/pi-store.test.ts
```

#### Manual Verification

Check cohort sizes against actual Convex transaction capacity and confirm that the future fence covers model dispatch, lookup claims, already claimed writers and native continuations. A scope that cannot be rebased atomically or a checkpoint requiring old-contract execution blocks target cutover. Missing target access leaves feasibility unverified; it does not block isolated candidate tests or justify invented cohort counts.

## Phase 2: Examine contributions and need associations without a global veto

Deliver a valid current examination from exact passages through retention, consultation and handoff. This phase establishes the result that recovery will later reuse.

### Change Outline

| Owner | Change |
| --- | --- |
| [sourcesContracts.ts](../../../convex/domain/sourcesContracts.ts), [documentaryControl.ts](../../../convex/integrations/documentaryControl.ts) | Replace the global `coherence` result with complete keyed findings, exact declared `needs` and targeted objections. Keep closed conclusions/uses and validate the entire identity set. Update examiner instructions in place. |
| [sourceSelectionPolicy.ts](../../../convex/domain/sourceSelectionPolicy.ts) | Extend `controlledDocumentaryUse` with optional need scope; intersect root/need findings and applicable restrictions using the existing use rules. |
| [sourcesMission.ts](../../../convex/sourcesMission.ts), [examineContributions.ts](../../../convex/sources/examineContributions.ts) | Retain current control version/hash, canonical availability and existing context-event reference; return the compact receipt instead of repeated full diagnostics. Exact reuse includes the new contract. |
| [sources.ts](../../../convex/domain/sources.ts), [sourcesWorkspace.ts](../../../convex/sourcesWorkspace.ts) | One shared projection exposes effective uses, scoped objections and current examination availability. Preserve accountable preparation versus economic answer. |
| [savedMaterialOperations.ts](../../../convex/domain/savedMaterialOperations.ts), [workbenchAgentOperations.ts](../../../convex/domain/workbenchAgentOperations.ts), [responseControl.ts](../../../convex/responseControl.ts) | Consume that projection in saved-material inspection, conversation and advisory facts; do not duplicate control interpretation. |

```diff
 documentary_control task output
- control: { findings, coherence, limitations }
+ examination:
+   { state: "examined", contractVersion: 2, control }
+   | { state: "not_examined", originalReference, recordedUses }

 current operation result
- full control and repeated diagnostics
+ taskId + controlVersion + context-event reference
+ effective contribution/need uses + objection count
```

Use the exact `DocumentaryExaminationState` from the TDD. `not_examined` is a normalized historical state, never a model result or per-need approval. Preserve the existing `documentaryAssessment` authorship metadata. Build and test the one-time original-observation import and recorded-use materialization against fixtures; target execution remains Phase 7. Preserve the exact original use calculation solely in this task-scoped conversion until historical uses are materialized, then remove it with the converter. Temporary old schema acceptance is conversion support only, with one current execution path.

Keep the single `{contributions,evidence,needs}` request and immutable quotation reconstruction. Reject missing/foreign findings, invalid targets, unsupported uses or unexplained narrowed associations as a whole. Later checks can only restrict their scope. Check actual control, receipt and handoff capacity before effects; overflow retains diagnostics and returns explicit technical incompleteness, without deleting objections or reviving an aggregate generated-response cap.

Introduce the TDD's Sources v9 / submission-and-check operation v3, Workbench v13 and inspection v5 shapes as the candidate current contracts, preserving Sources native completion. Reach runtime projection, `nativeToolSets`, prepared profiles and schema hashes through the same input/result selector. Production bindings and retained-owner conversion stay fenced until Phase 7. Do not revise the Sources method package unless its existing content conflicts with the changed contract.

### Validation

#### Automated Verification

- [ ] RED then green: faithful attributed vendor material survives, its independent-outcomes association is blocked, and unrelated material remains useful. Actual overstatement is refused.
- [ ] Cover each distinct identity/target/use guard, missing explaining objection, incompatible restrictions, later narrowing, whole-result rejection and transactional capacity failure without partial qualification.
- [ ] Cross real submission/check, retainControl, shared projection, prepared-need consultation and handoff. Contextual preparation can be complete; explicitly unfinished outcomes work stays partial without a fabricated gap or economic-answer gate.
- [ ] Read a converted historical fixture through workspace, consultation and advisory facts: frozen membership/uses remain historical, current examination is unavailable, original body is paged through its audit reference, and no inference occurs.
- [ ] Assert current prepared/runtime/native variant contract-key equality and receipt paging through `consult_mission_state`.

```sh
pnpm exec vitest run src/__tests__/convex/integrations/documentary-control-transport.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/sources/source-selection-policy.test.ts src/__tests__/convex/sources/sources-completion.test.ts src/__tests__/convex/sources/sources-workspace.test.ts src/__tests__/convex/execution/native-profile-identity.test.ts src/__tests__/convex/sources/generation-resilience-transition.test.ts
```

#### Manual Verification

Inspect the actual serialized schema/input and the compact receipt beside its full journal observation. Verify that diagnostics distinguish attributed use, contextual usefulness and unperformed outcomes research. Fixture model replies verify contract handling, not the live examiner's judgment quality.

## Phase 3: Separate termination from cost and establish correct accounting baselines

Deliver truthful receipt facts and conservative admission before adding another source of interruption or any cross-worker replacement inference.

### Change Outline

Extend [modelTransport.ts](../../../convex/integrations/modelTransport.ts) and existing invocation receipt metadata to retain native `rawFinishReason` through the real SDK completion path. In [schema.ts](../../../convex/schema.ts), [providerCalls.ts](../../../convex/providerCalls.ts) and [openRouterGeneration.ts](../../../convex/integrations/openRouterGeneration.ts), record stream finish or identity-matching lookup cancellation as the TDD's provenance-bearing `termination` union. Local abort, EOF, normalized `other`, generation identity and cost alone do not establish termination.

Request/claim eligibility must examine missing termination independently of known cost. Parse matching cancellation even when cost is absent/invalid; validate charge separately and keep conflicts visible. This phase can settle factual evidence without closing a lost worker or dispatching replacement inference. Automatic operation-owned lookup continuation is connected in Phase 6.

Change the shared classifier in [sourcePreparationAuthority.ts](../../../convex/domain/sourcePreparationAuthority.ts) together with the versioned accounting baseline in [qualificationUsage.ts](../../../convex/qualificationUsage.ts). Preparation budget becomes version 2; qualification projections gain `projectionVersion: 2`. New receipt admission and ordinary deltas explicitly refuse an unconverted baseline. New scopes initialize current projections; conversion computes authoritative totals before current deltas can run.

```text
admission fence → drain claimed receipt writers → record conversion frontier
  → atomically rebase each complete run/context scope and stamp version 2
  → verify every related scope → release ordinary deltas
```

Build this resumable task conversion through the existing owners and test it now; run it on retained target data only in Phase 7. Preserve unexplained consumption conservatively, lifetime attempts, recorded charges, both financial reservations and finality policy. Do not clamp discrepancies, count missing cost as zero or release an earlier reservation to finance another attempt. Same-preparation recovery remains limited by the existing selector, with `explicit_recovery_required` after the second attempt.

### Validation

#### Automated Verification

- [ ] RED then green: identical valid output with explicit finish versus EOF yields distinct terminal knowledge and safe admission; confirmed cancellation without cost retains full financial reservation; cost-only settlement cannot clear execution uncertainty.
- [ ] Seed old EOF receipts with old materialized accounting. Convert twice, then apply cost-only and terminal-only evidence separately, including closed work. Persisted and receipt-derived totals agree, counters remain nonnegative and lifetime dispatches do not change.
- [ ] A stale projection version refuses admission/deltas transactionally; an interrupted conversion resumes across completed scopes without exposing partial scope totals.
- [ ] Derive the two-reservation budget expectation independently: for a fixture reservation of $0.125 per attempt, exactly $0.250 admits both and $0.249 refuses the second while retaining the first. Assert actual monetary totals and call consumption, not only an admission return code.
- [ ] Wrong generation identity, conflicting costs, expired authority, cancelled analyst work and disallowed terminal failures remain blocked; metadata settlement never grants inference.

```sh
pnpm exec vitest run src/__tests__/convex/integrations/provider-billing.test.ts src/__tests__/convex/integrations/documentary-control-transport.test.ts src/__tests__/convex/sources/source-preparation-budget.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/sources/generation-resilience-transition.test.ts
```

#### Manual Verification

Inspect one before/after receipt and its run/context projections. Explain every changed bucket using terminal evidence; retain the old observation and unchanged monetary authority. The seeded negative-counter example demonstrates a stale-baseline risk, not a negative balance observed in production.

## Phase 4: Interrupt excessive whitespace through the shared structured transport

Deliver early interruption with inspectable output and truthful uncertainty. This phase does not promise durable recovery before the scheduler changes are complete.

### Change Outline

Add the named threshold and supported policy identity in [resourcePolicy.ts](../../../convex/resourcePolicy.ts). Pin `structuredOutputPolicy` when current preparation is created; pass and retain the same snapshot through [preparationModel.ts](../../../convex/sources/preparationModel.ts), invocation creation and provider receipts. Retries inherit the snapshot. A missing or unsupported current snapshot refuses dispatch; historical pins are addressed by conversion rather than a fallback.

In `modelTransport.ts`, extend the raw text middleware before its 61,440-character packing with the private lexical observer: `inString`, `escaped`, `visibleResponseStarted` and consecutive outside-string whitespace count. Observe only SP/TAB/LF/CR, carrying state across fragments. The native SDK still parses/validates. At the accepted boundary use existing cancellation and emit `structured_output_whitespace`; retain received text and known usage through the existing writer/settlement grace.

Apply this once to eligible documentary examination, qualification and comparison. Do not change Pi free-form generation, add a separate JSON parser, switch SDK/provider, enable SDK retries or add SSE-byte/duration bounds. An interrupted complete object with trailing whitespace is not adopted as normally finished or called syntactically invalid.

### Validation

#### Automated Verification

- [ ] RED then green through the consuming transport: 4,095 continues; 4,096 interrupts with the selected policy retained. Test a nondefault pinned threshold to detect a hardcoded caller literal.
- [ ] Cover fragment splits, mixed JSON whitespace, non-whitespace reset, long valid string values, open string keys, escaped quotes/split backslashes, initial reasoning and complete-object trailing whitespace. Assert retained text/capture status and absent domain adoption.
- [ ] Exercise both qualification and comparison callers through their registered action boundaries. They retain their existing explicit unfinished contract; neither receives an operation pending descriptor or another scheduler.
- [ ] Replay the retained failing text and a successful control through the real transport with synthetic chunk timing. Record input hashes, emitted/retained text equality, interruption position and typed outcome; keep elapsed timing observational, outside CI acceptance thresholds.

```sh
pnpm exec vitest run src/__tests__/convex/integrations/documentary-control-transport.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/sources/source-qualification-action.test.ts src/__tests__/convex/sources/source-comparison-action.test.ts
pnpm resource-policy:check
```

#### Manual Verification

Compare replay output with the original bytes actually delivered before abort, including the boundary-crossing fragment. Synthetic timing does not reproduce upstream latency or prove upstream repair. Keep the accepted risk visible: otherwise valid JSON with excessive insignificant whitespace can be interrupted.

## Phase 5: Recover committed results through fenced scheduled execution

Deliver safe replay of retained work without a replacement model call. Establish this path before permitting recovery after a worker disappears.

### Change Outline

Extend [executionProtocol.ts](../../../convex/execution/executionProtocol.ts) and [agentCatalog.ts](../../../convex/execution/agentCatalog.ts) with the concrete scheduled-operation opt-in `scheduledRecovery: structured_model_v1`, valid only for eligible declared operations. Replace `scheduledJobId`/`scheduledStartedAt` in [execution/schema.ts](../../../convex/execution/schema.ts) with the TDD's phase-valid `scheduledExecution` record. No arbitrary bag of optional fields or second scheduler is needed.

Update [operations.ts](../../../convex/execution/operations.ts) at claim, begin, result settlement and exception handling. Carry request, epoch and dispatch generation through every scheduled action, including nonrecovering acquisition and native skill reading. Update [cancellation.ts](../../../convex/execution/cancellation.ts), [piControl.ts](../../../convex/execution/piControl.ts), [sourceCaptureActions.ts](../../../convex/sourceCaptureActions.ts) and [agentSkillReader.ts](../../../convex/integrations/agentSkillReader.ts) consumers of the old scheduling fields/signature. Non-opt-in operations keep one-start behavior.

Bind Sources reservation, provider admission, domain retention and both settlement paths to the same epoch/call identity. Keep original request admission generation and old invocation pins immutable; a later `adoptionGeneration` does not create dispatch authority. The first structured invocation is distinct from the proposing agent invocation and names the immutable input reused later.

```text
scheduled exception, after validating its epoch
  retained final operation outcome → recover existing outcome
  committed control/qualification → recover compact receipt and context reference
  complete validated one-shot result → adopt once under current authority
  no recoverable retained result → explicit wait/unfinished state; no replacement yet
```

Reach that order from the real `executeScheduledOperation` / `settleDispatchFailure` path before generic uncertain-effect mission blocking. Inspect factual retained records without requiring the mission to be running; require current authority for new adoption. Make `retainControl` idempotent for existing run/type/input-hash and provider ownership. Do not convert every unknown external effect into a retry or mutate a final unavailable outcome into success.

### Validation

#### Automated Verification

- [ ] RED then green for lost acknowledgement after real `finishOneShot` and `retainControl` commits; retain the existing passing final-operation-commit case. Drive the registered scheduled action and assert one receipt, one qualification, one context reference and one final operation result, with no extra inference.
- [ ] Duplicate job delivery, duplicate result acknowledgement and a changed domain head cannot insert another effect. Retained invalid/partial output cannot masquerade as a validated result.
- [ ] Delay obsolete-epoch success and failure until a successor epoch owns the request; neither can settle, adopt for or block its successor. Late factual receipt settlement remains allowed only for its own attempt.
- [ ] Preserve initial queued cancellation, engaged-operation semantics and one-start behavior of acquisition/skill-reading operations through registry-discovered conformance fixtures.

```sh
pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/workbench-documentary-continuity.test.ts
node --experimental-strip-types scripts/check-execution-boundaries.ts
```

For any genuinely new multi-layer recovery boundary, run bounded temporary falsifications against missing epoch validation and bypassed retained-result recovery; observe the consuming tests fail, then restore the source.

#### Manual Verification

Inspect the committed facts at each injected acknowledgement loss and the next scheduled outcome. A test that manually unblocks the mission or directly invokes a recovery mutation does not prove that the real exception path is fixed.

## Phase 6: Continue an interrupted examination across worker lifetimes

Deliver the central recovery result: after a confirmed unusable attempt, the same operation can complete within its existing allowance, including worker loss and an analyst pause/resume.

### Change Outline

Extend `operations.ts`, [invocationLifecycle.ts](../../../convex/execution/invocationLifecycle.ts), [researchControl.ts](../../../convex/execution/researchControl.ts), `providerCalls.ts`, `openRouterGeneration.ts`, `sourcesMission.ts`, `sourcesMissionActions.ts`, `examineContributions.ts` and `preparationModel.ts` through their existing responsibilities:

| Transition | Owner and required behavior |
| --- | --- |
| Admit worker epoch | Operations retains action start/platform execution boundary and atomically owns one recovery wake. Keep transport cutoff, platform deadline, logical deadline and financial reservation distinct. |
| Observe generation identity | Provider receipt mutation retains identity and arms eligible reconciliation atomically; a crash before finalization cannot orphan a known generation. |
| Return pending work | Preparation helper returns a pending descriptor only for a validated opt-in operation; Sources returns existing `waiting`, preserving work consumption and immutable input. |
| Recover lookup loss | Billing claim arms expiry at its existing `retryAt`; reclaim an abandoned checking claim with a new attempt fence. Inspect prior committed settlement before another lookup. Late obsolete settlement cannot win. |
| Fence abandoned generation worker | Operations inspects the owned scheduled job or elapsed platform boundary. A live worker or unknown remote outcome cannot authorize a replacement. |
| Close abandoned local attempt | Invocation lifecycle first recovers a validated retained result, otherwise records `structured_result_unavailable` only after matching terminal evidence. Close the started receipt once through normal receipt/accounting settlement. |
| Admit continuation | Operations rechecks current dispatch authority, slot, policy/input/evidence, versions, deadline, attempts and both financial reservations before a new epoch. Reuse the original preparation and work row. |
| Reach an effective analyst pause | Operations commits a fenced `waiting_provider` epoch and invokes the existing research-control pause boundary, including before the waiting-result early return and after its owned wake. Public Pause checks an already safe wait immediately. Research control exempts only that proven safe wait from engaged-work drain protection, then atomically pauses the run, clears its requested flag and advances generation once, releasing its slot. Other live/queued research work still prevents early pause. |
| Reconcile and resume | While paused, owned wakes retain provider/attempt facts without new documentary adoption or inference. Public Resume from that actual paused state atomically reclaims the slot before a current-generation epoch; contention leaves it paused and adoption-only rebind is insufficient. |

Use the platform action boundary from `resourcePolicy.ts`, never the receipt lease ending at logical deadline plus settlement grace. Ordinary pending return or an observed terminal job can advance the owned wake without waiting for that financial fence. Metadata retries use the billing owner's existing timeout/cooldown/retryAt and logical recovery window; no polling daemon or invented cadence.

Keep the safe-pause check in `pauseResearchAtBoundary`, consuming the operation owner's durable epoch/worker facts. Require a recovery declaration, `waiting_provider` phase and no unfenced generation/tool/domain worker or queued inference able to advance that epoch. Remote termination may still be unknown: after local fencing it blocks replacement inference, not the requested pause. Recheck every engaged research request through the existing indexed owner; one safe wait cannot hide another live operation. Cancel or fence queued continuation through its owner before declaring that wait safe. Do not use an unconditional checkpoint call or a new pause-state store as a shortcut.

Pause admission and continuation admission read the same run/epoch transactionally so a requested pause blocks another inference. Preserve the waiting operation, original structured input, preparation, deadlines and all reservations/counters through pause and resume. Keep ordinary `cancel_pause` semantics if the analyst changes their mind before a live operation drains, but do not count it as the paused/new-generation path. Duplicate controls and wakes must not change generation twice or create successor workers. Paused metadata recovery must not enqueue research workers merely to discover that dispatch is forbidden.

After attempt two, preserve `explicit_recovery_required` as unfinished work. Do not create a successor preparation, automatically use the separate third lifetime allowance or reset counters. Once authority closes, late accounting remains factual but cannot revive inference. Qualification/comparison retain their non-operation contract from Phase 4.

### Validation

#### Automated Verification

- [ ] Exercise the actual scheduled path: lose the worker after generation identity retention and before `finishOneShot`, with logical time still available; drive its owned worker-boundary wake; obtain matching cancellation without cost; close the original started receipt; reserve both attempts; replace once; qualify and finalize once before the unchanged logical deadline.
- [ ] Separately exercise empty/invalid output with explicit finish, detector abort followed by remote confirmation, EOF with complete JSON but no finish, cost-only evidence, not-found then confirmation and an unavailable lookup whose worker disappears after claim. No confirmation means no replacement.
- [ ] Lose lookup-settlement acknowledgement after its real commit; duplicate wakes and late original-worker acknowledgements do not duplicate lookup ownership, inference, qualification or operation completion.
- [ ] Through the registered scheduled path, interrupt the examination and call public Pause while the worker remains live. Verify the request remains pending until the owned wake fences that worker; then assert an actual paused run, `researchPauseRequested === false`, exactly one generation increment, released slot, same waiting operation/input/preparation, unchanged deadline and reservations, and no replacement inference. A second live or queued operation must still prevent early pause. Also cover public Pause after a safe wait already exists, without waiting for another model turn.
- [ ] Reconcile while genuinely paused without inference or new documentary adoption, then exercise public Resume with slot-contention refusal and subsequent successful atomic slot reclaim/current-generation epoch. Verify unchanged consumption and identity, plus duplicate-control/wake idempotence. Do not seed paused state, invoke a recovery mutation directly or count `cancel_pause` as this positive-resume proof. Retain a separate cancel_pause case while a live operation is still draining.
- [ ] Cancellation, deadline expiry, stale instructions/evidence, lost slot, cooldown and budget exhaustion each retain explicit containment without new inference; adoption rebind alone grants no continuation dispatch.
- [ ] Test first failure → second attempt, then exhaustion without an automatic third/fourth call or new preparation. Cooldown schedules eligible work rather than spinning. Assert cumulative receipts, financial totals, work rows, identities and final outcome.
- [ ] Run bounded falsifications for bypassed terminal proof and omitted original-reservation accounting; the real scheduled integration cases must fail before restoration.

```sh
pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/integrations/provider-billing.test.ts src/__tests__/convex/sources/source-preparation-budget.test.ts src/__tests__/convex/sources/sources-recovery.test.ts src/__tests__/convex/sources/sources-pause-admission.test.ts src/__tests__/convex/sources/sources-completion.test.ts
```

#### Manual Verification

Inspect the full timeline: one logical request/input/preparation, separate attempts/receipts, terminal evidence, financial reservation, worker fence and unique final adoption. Do not renew the logical deadline to make the fixture pass. Deferred accounting can remain open after useful completion where the existing financial policy permits it.

## Phase 7: Convert retained work, retire replaced contracts and verify the complete path

Complete the coherent delivery batch on the authorized matching target. Candidate tests are not evidence that retained target data or native checkpoints can be converted.

### Change Outline

Re-run the Phase 1 inventory against the frozen candidate/target. Stage only temporary schema support needed by the concrete conversion. Under the established admission fence, drain old model/lookup/native writers, settle native tails through their original lifecycle and preserve pending factual accounting for replay. Do not force quiescence by cancelling analyst work, deleting checkpoints or issuing inference.

Apply the task-scoped resumable conversion in existing persistence owners:

1. Preserve original examination bytes and provenance through the immutable journal; materialize historical contribution-level uses once with the original policy and normalize unexamined current state. Preserve completed handoff membership and decisions.
2. Rebase each complete preparation/campaign accounting scope and stamp current versions before enabling ordinary receipt deltas. Convert supported terminal evidence and scheduling facts without changing old invocation pins.
3. Convert idle conversations' future-turn binding and safely paused Sources missions' future definition/policy according to the TDD mapping in `conversations.ts`, `missions.ts`, `piStore.ts` and `piControl.ts`. Preserve queue, append-only history, objective/completion identity, preparation, counters and deadlines; a paused mission remains paused.
4. Verify all cohorts and current Sources v9, Workbench v13 and inspection v5 runtime/native/prepared profiles. Remove only executable variants replaced by this correction, original global-control instructions/validators, old cancellation/scheduling interpretation and temporary converter/widened validators. Historical immutable identities remain data, not executable aliases.
5. Release admission only after the final single-contract build and data agree. Replay eligible factual accounting through current owners; do not awaken cancelled/expired research or claim missing current examination was performed.

If an unsafe checkpoint, resumable unknown call, oversized atomic projection scope or required historical consumer remains, retain the fence and name that concrete cutover blocker. Do not leave a supported legacy mode, partially converted scope or silent reset as the final state. The tested conversion source may remain frozen as an artifact outside the active build; final runtime tests seed normalized historical records and verify readers after the converter is removed.

Update [TECH.md](../../../context/TECH.md) in its existing scheduled execution, semantic control, recovery/accounting and provider passages after implementation verification. Update [ROADMAP.md](../../../docs/ROADMAP.md) with delivered capability and remaining qualification limits. Search reference and historical descriptions of the replaced mechanism, preserving original evidence and adding dated supersession notes where needed. Leave PRODUCT untouched: this batch implements its existing preparation, authority and interruption contract. Do not add normative documents or edit immutable raw evidence.

### Validation

#### Automated Verification

- [ ] Run the converter twice on seeded and authorized retained cohorts; compare exact content hashes, recorded uses, transcript/queue, mission/objective/completion identities, reservations, charges, counters and deadlines. Confirm unsupported checkpoints block conversion without partial effects.
- [ ] After removing old definitions, resume a converted idle conversation and a safely paused Sources mission through real admission/native paths. Old responses cannot acquire new adoption authority. Inspect completed history and current assessment absence with zero model calls.
- [ ] Verify active build absence of replaced fields/validators, obsolete executable variants and converter exports; assert current runtime/native/prepared profile keys agree. Do not hand-edit generated profile data; use its existing owner and verify the resulting keys without generation calls.
- [ ] Run the affected suite groups from earlier phases, registry conformance and ownership checks. Format changed task files once, then use scoped Biome diagnostics. Run both frontend/backend typechecks because the shared documentary result reaches their consumers.

```sh
pnpm exec vitest run src/__tests__/convex/sources/generation-resilience-transition.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-store.test.ts src/__tests__/convex/execution/native-profile-identity.test.ts src/__tests__/convex/integrations/profile-catalogue.test.ts
node --experimental-strip-types scripts/check-execution-boundaries.ts
pnpm resource-policy:check
pnpm typecheck
pnpm docs:check
```

Run `pnpm check` once after the candidate stabilizes: this batch changes durable execution, stored schemas, accounting, shared tool contracts and historical readers, so the CI aggregate is warranted. Do not repeat the aggregate between routine edits; rerun only invalidated focused checks after subsequent fixes, then the required final gate.

#### Manual Verification

On the verified matching local backend, first establish successful watcher publication of the final revision. Exercise scoped objection → handoff and interruption → reconciliation → same-operation recovery through the actual scheduled path using controlled external fixtures. Verify pause/resume, unique adoption and honest incomplete outcome without a real paid model call. If the installed local harness cannot drive the changed path without inference, report that runtime limitation instead of making an unbudgeted request or claiming completion from `convex-test` alone.

Retain a dated verification report with candidate/target identity, cohort counts, hashes, executed checks, observed RED/falsification, conversion/removal evidence and remaining limits. Deterministic/live-local mechanics do not establish semantic examiner reliability or general provider resilience. A separately authorized paid qualification uses the evaluation skill and targets these corrected operations and honest partial outcomes; no comparison study of the second call is included.

## Coverage and Completion

| Required outcome | Owning phases and acceptance evidence |
| --- | --- |
| Scoped objections and useful independent material | Phase 2 real submission/check, shared readers and handoff. |
| Honest historical examination and preserved decisions | Phases 1, 2 and 7 cohort conversion, hashes and post-retirement reads. |
| Native finish proof separate from cost | Phase 3 real SDK/metadata fixtures and versioned receipt accounting. |
| Counter and policy across shared callers | Phase 4 boundary cases, pinned nondefault policy and retained-data replay. |
| Lost acknowledgements and obsolete-worker fencing | Phase 5 real action exception paths and delayed epoch settlement. |
| Lost generation/lookup workers and same-operation recovery | Phase 6 scheduled wakes, local receipt closure, original reservation and unique adoption. |
| Effective pause, resume and unchanged authority | Phase 6 public Pause → worker fencing → genuinely paused run → paused reconciliation → contended/successful public Resume, original waiting operation, two-attempt boundary and negative guards. |
| No maintained legacy and runnable converted work | Phase 7 converter-twice evidence, active build audit, native resume and matching local runtime. |

Completion requires all seven phases and the applicable checks, with any target conversion/runtime blocker explicit. A passing fixture, static typecheck, completed design review or model assertion is not interchangeable with these observations. Every command above is proposed implementation verification, not a check already run while writing this outline.

## Open Questions

No product or architecture choice is reopened by this outline. Target cohort sizes, safe native checkpoint feasibility, transaction capacity and the authorized target lifecycle remain empirical preflight items. The code-reviewer's effective-pause finding has a specified correction and public-boundary regression; its behavior is unimplemented. Independent performance review and original review verdicts are recorded against their frozen inputs. Paid qualification remains outside this authorization.

## Outline Verification

While preparing the original outline, current source owners, test entry points and package scripts were inspected. `pnpm docs:check` passed: 82 Markdown files, 461 local links, zero errors and the existing advisory TECH word-count warning; its 35 local links and input fingerprints were checked separately. The later pause correction was verified against current public control, engaged-work, waiting-result and slot predicates. Its updated link/fingerprint checks and independent review are recorded separately rather than extending those earlier results to changed content. No production code was changed. No behavioral test, backend publication, target-data conversion or paid inference ran for this documentation revision.
