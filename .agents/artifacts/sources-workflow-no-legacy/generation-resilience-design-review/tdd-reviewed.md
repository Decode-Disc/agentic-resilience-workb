---
type: design-tdd
repos:
  - identifier: "agentic-resilience-workbench-proto"
    sha: "168981b3c48a7d20062e39e2a2df71689c1036d4"
flow: tdd
status: complete
system_design_approved: true
program_design_approved: true
completion_notification:
  project: agentic-resilience-workbench
  sender: Codex
  event: design-approved
  key: generation-resilience-tdd27-168981b3-no-legacy-approved
  revision: "168981b3c48a7d20062e39e2a2df71689c1036d4"
  message: "TDD de résilience validé et terminé : objections ciblées, seuil de 4 096 blancs hors chaînes JSON, reprise durable et retrait des contrats remplacés. Vérifications documentaires réussies. Aucune implémentation lancée."
  message_id: 1123
  receipt: "/home/abdwhb/.local/state/agent-stack/notify/db00554a0e47f4d0dadf2dc98e6c61103f4ae228f541b4cc80cf9c4968c4c689.json"
---

# Documentary Examination and Recovery from Nonproductive Generation

The [original request](24-request-generation-resilience.md) defines the recovery outcome and constraints. The [research](26-research-generation-resilience.md) establishes its baseline behavior and executable evidence. On November 26, the user extended the design discussion to improve the existing submission-time documentary examination contract, accepted targeted coherence objections and the same-operation recovery cycle, and selected the whitespace counter and its initial threshold. The [Pi/AI SDK investigation](pi-whitespace-investigation/report.md) supplies subsequent transport evidence. After clarification of the actual request contents and observed input sizes, the user authorized continuing to detailed design and then required removal of replaced code rather than maintained legacy paths. The user explicitly approved both System Design and the revised Program Design. This completes the TDD; implementation remains unauthorized.

## System Design

### Keep submission-time examination and improve its documentary contract

Accepted direction: Sources continues to submit documentary contributions through the existing operation. The server validates exact evidence and authority, a separate model examination evaluates the submitted material, and the domain owner determines effective use. Preserve the current AI SDK structured-examination path and native Pi mission execution; switching transport libraries is not part of this correction. The user explicitly excluded a study of the second call's incremental benefit from this prototype work. Functional verification of the corrected contract remains required.

The examination distinguishes fidelity of a contribution, its permitted documentary use and applicability to each declared need. Faithful attribution does not establish the attributed claim as an observed outcome. Conversely, failure to establish an economic answer must not by itself erase a faithfully represented vendor position. A contribution can remain usable under attribution or context restrictions while an unsupported association with another need is refused. A contribution that overstates its evidence is not silently rewritten or made admissible through a weaker label.

Accepted coherence change: replace the required global boolean with objections attached to identifiable contributions or uses. The examination cannot issue an unscoped veto over independent material. The server validates that findings and objections refer to submitted identities and current versions, then applies restrictions to the affected material. Contextual relevance cannot establish answer sufficiency, completed documentary coverage or analytical authority. The exact closed output representation and one-time transition belong to Program Design.

### Preserve one submitted artifact and adopt only a complete examination

Accepted cycle: retain the submitted contributions, evidence, need associations and their observed versions as the original logical operation's work. Technical attempts must not create new contribution identities, request another reading from Sources or recreate the preparation. Each attempt retains its own provider receipt, observed termination and resource consumption. Reuse an already valid examination only through the existing exact-identity rules; no semantic-equivalence model or second deduplication engine is introduced.

A complete examination must cover the submitted identities, express only permitted dispositions, and pass current evidence, version and authority checks before adoption. Diagnostic prefixes and partially parsed findings are never adopted as successful controls. Adoption is idempotent and cannot overwrite later contributions or analyst changes. Unaffected valid contributions survive targeted restrictions after a complete control; this is distinct from adopting fragments of an interrupted response.

### The harness continues the retained logical operation

Today, a known invalid first response can be retried inside the running action. An interrupted documentary control remains unavailable after later cancellation/billing confirmation: settlement does not wake the operation, and its scheduled-start and work-reservation guards prohibit re-entry. Separately, EOF without terminal proof can currently be misclassified as a retryable invalid response.

Selected by the user: keep the original logical operation while the existing harness owns any further authorized model attempt. Each attempt has its own receipt and accounting. A retry requires confirmed external termination, no previously adopted result for that work, current authority and remaining attempt/resource allowance. It must not recreate the preparation, clear start markers or replay prior documentary effects. An uncertain connection closure waits for terminal evidence rather than triggering another generation.

The existing operation lifecycle will own durable continuation, with the existing attempt admission and provider receipts. This extends the current one-start contract; it does not globally enable SDK retries. The native agent receives the operation's eventual outcome or explicit unresolved/exhausted state without needing a model turn solely to request a technical retry.

Continuation observes retained facts through the existing operation scheduler and authority owner. A settlement update can make the operation eligible for recovery; it cannot itself authorize dispatch. Each replacement attempt must recheck the active mission/generation, workflow and instruction versions, evidence freshness, pause/cancellation state, execution slot, deadline and cumulative admission. A duplicate wake observes retained work. An expired or cancelled operation cannot gain another call from late billing, and an already adopted result cannot be regenerated. Exhausted recovery remains explicit unfinished work.

```mermaid
flowchart LR
    Work[Retained logical operation] --> Attempt[Admitted model attempt]
    Attempt --> Evidence[Retained result and terminal evidence]
    Evidence -->|Valid result and current authority| Adopt[Adopt once]
    Evidence -->|Remote outcome unknown| Wait[Await reconciliation]
    Wait --> Evidence
    Evidence -->|Confirmed unusable result| Admission[Existing retry and resource admission]
    Admission -->|Further attempt authorized| Attempt
    Admission -->|Authority or allowance exhausted| Partial[Explicit unfinished outcome]
```

### A confirmed terminal attempt can retain its financial reservation during recovery

Selected by the user: confirmed external termination and final financial settlement remain separate facts. When final cost is missing, retain the earlier attempt's full financial reservation and allow a further authorized attempt only if existing cumulative admission covers both reservations. Final billing subsequently settles the original receipt through the existing accounting owner. A missing cost never becomes zero, the old reservation is not released to fund the new attempt, and the grant is not enlarged. Unknown remote outcome and cost conflicts remain separate blockers. Existing attempt, deadline and authority checks still apply independently of available funds.

Terminal evidence must come from an explicit provider terminal event or an identity-matching provider cancellation confirmation. Local abort, socket closure, a generation ID, a known charge or an SDK-inferred finish value cannot independently prove remote termination. Preserve the original outcome and evidence source rather than converting every failure into retryable invalid output. The provider metadata reader must be able to retain verified cancellation separately from a valid final cost. The existing retry selector remains responsible for deciding which confirmed failures are recoverable; no unconditional retry of all terminal failures is introduced.

### Early detection counts consecutive JSON whitespace outside strings

Selected by the user on November 26: use the number of consecutive JSON whitespace characters outside string values as the primary detector for now. This refines the earlier whitespace-without-progression direction and replaces a new duration-without-progress threshold as the preferred criterion. Count only space, tab, line feed and carriage return in a visible response that has begun. Preserve the count across provider fragments; a non-whitespace character ends the sequence. String contents, escaped quotes and initial reasoning must not be mistaken for an outside-string sequence. This is a narrow generation safeguard, not an aggregate response-size, SSE-wire-byte or semantic-repetition limit.

Observation must precede the application's current text packing, while the native SDK remains responsible for decoding and schema validation. An unchanged partial object alone is insufficient: an executed native-parser probe returns the same partial object for an open string key and an outside-string incomplete value. The public partial-output API does not expose lexical string state. The counter therefore needs only a private lexical observation of quotes and escapes across fragments; it must not construct values, repair JSON or replace the native parser. Existing execution deadlines and the selected terminal-evidence/recovery rules remain effective.

Accepted initial threshold: interrupt when the run reaches 4,096 consecutive outside-string JSON whitespace characters. This is an explicit prototype safety policy, not a JSON grammar limit, model capability or claim that every interrupted output is invalid. Retained-data measurements found 158 consecutive outside-string JSON whitespace characters in one successful response and 1,131,782 in an interrupted historical response. The two inspected qualification archives and the later two diagnostic successes supply only three successful one-shot documentary responses, so they cannot establish a general false-stop rate. Legitimate JSON can contain more insignificant whitespace and may be interrupted under this selected policy. Keep the named value in the existing resource-policy owner, with purpose, unit and policy identity retained for the invocation; do not copy literals into callers.

The detector targets eligible shared structured one-shot calls, including documentary examination and its existing qualification/comparison siblings. It is not automatically applied to free-form Pi text or all native tool arguments. Capture the received diagnostic text without converting its whitespace into evidence. A detector interruption is a distinct technical outcome and follows the accepted remote-termination/recovery cycle; hitting the counter is not proof of remote cancellation. No additional progress-duration threshold, provider pin or automatic SDK retry is selected.

The [Pi/AI SDK investigation](pi-whitespace-investigation/report.md) establishes that excessive whitespace was already present in the OpenRouter-origin trace and that both installed transports preserve identical replayed whitespace. Neither switching SDKs nor the counting policy is a demonstrated repair of upstream generation.

### One current contract, verification and delivery boundary

Accepted constraint: after a verified transition, the affected runtime uses one current examination contract, detector policy and scheduling representation. Remove the replaced validators, instructions, executable definitions and version-dispatch branches; do not retain them as a compatibility mode. Version identities remain useful for audit without keeping their executors alive. Preserve historical evidence, receipts, decisions and original findings. An old global control cannot become a new per-need approval by conversion. Program Design specifies a bounded transition and retirement within the existing owners, without a second engine, generic migration framework, data reset or automatic model re-examination.

Required verification uses the real shared and domain boundaries, replacing only external nondeterministic I/O. Cover faithful attributed material versus overstated outcomes; different applicability across needs; targeted coherence restrictions with independent material preserved; complete/invalid/unknown control outcomes; and stale evidence or authority. Counter cases include the exact 4,095/4,096 boundary, fragment splits, mixed JSON whitespace, non-whitespace resets, escaped quotes/backslashes, open keys, long valid strings and initial reasoning. A syntactically complete object followed by a long outside-string whitespace sequence remains subject to the selected counter, but the interruption must not be falsely reported as a JSON syntax error or silently adopted as a normally finished response.

Recovery verification must exercise actual scheduled-operation continuation across action lifetimes, including separate terminal and cost evidence, both reservations, retained attempt limits, lost acknowledgements, duplicate wakes, pause/cancellation, deadline exhaustion and one-time adoption. Cover applicable structured one-shot siblings through the shared owner. Local retained-data replays establish mechanics, not general provider reliability. Any final paid qualification requires a separately authorized targeted mandate; no architectural benefit study or broad comparison campaign belongs to this correction.

Accepted delivery boundary: implement and verify the corrected documentary contract, detector and durable recovery as one coherent correction batch. This replaces the earlier unaccepted alternatives that depended on calibrating a new inactivity duration. The detector threshold's accepted false-stop risk remains explicit; no recovery-only delivery can be described as complete early detection.

## Program Design

Accepted by the user. Names below identify concrete additions to existing owners, not a new engine or framework.

### Versioned examination result and deterministic use calculation

Keep the current single-request input `{ contributions, evidence, needs }` in `sources/examineContributions.ts`. The server continues reconstructing exact quotations and neighbouring context from immutable captures before dispatch. Do not introduce documentary pagination, additional retrieval, semantic deduplication or an input-format redesign in this correction. Recovery uses the retained original examination input; Sources does not resubmit it.

Replace the current result in `domain/sourcesContracts.ts` with v2, with the matching Zod schema owned by `integrations/documentaryControl.ts` as today. Replace the old validator and examiner instructions rather than retaining a v1 execution path. The new model result has `findings` keyed by each submitted contribution identity and `objections`; it has no global `coherence` boolean. Each finding retains `conclusion`, `permittedUse` and `diagnostic`, with `conclusion` explicitly judging fidelity for the stated documentary use. Add `needs`, keyed by that contribution's exact declared need IDs, with the permitted-use enum as each value. Explanations of restricted associations belong to targeted objections rather than duplicating long diagnostics in every need entry. Do not ask whether the economic question has been answered.

For example, a correctly attributed vendor argument can return:

```json
{
  "findings": {
    "contribution-1": {
      "conclusion": "supported",
      "permittedUse": "attributed_argument_only",
      "diagnostic": "Faithfully reports the issuer's position.",
      "needs": {
        "review-authority": "attributed_argument_only",
        "customer-outcomes": "blocked"
      }
    }
  },
  "objections": [{
    "targets": [{
      "contributionId": "contribution-1",
      "needId": "customer-outcomes"
    }],
    "maximumUse": "blocked",
    "diagnostic": "Provides no independent evidence of customer outcomes."
  }]
}
```

The IDs above are illustrative; production keys are the submitted identities. Every expected finding and declared need must appear once. Unknown or missing keys, illegal uses or malformed targeted objections invalidate the complete result; no partial finding is adopted. Retain the existing closed conclusions and permitted-use vocabulary and current diagnostic capacity rather than inventing another confidence scale.

An objection contains `targets: [{ contributionId, needId: string | null }]`, `maximumUse` and `diagnostic`. A null need targets the contribution; a specific need targets only that association. Targets must exist in the submitted artifact, and each objection has at least one target. Group targets sharing the same contribution and restriction into one objection, combining their explanation rather than repeating the same target. The existing three restrictive uses determine the available groups; no unrelated fixed objection-count limit is introduced. `maximumUse` is a restrictive existing use (`attributed_argument_only`, `context_only` or `blocked`), never an additional factual permission. Every need use narrower than its contribution must have an explaining targeted objection. The server intersects the declared use with the objection restriction; inconsistent or unsupported widening never becomes additional authority.

Extend `domain/sourceSelectionPolicy.ts`'s existing `controlledDocumentaryUse` to consume the current control and an optional need identity. Contribution-level evaluation uses the root finding and contribution-targeted objections. Need-specific evaluation additionally intersects the need finding and applicable need-targeted objections. Missing support, an illegal contribution-kind use, an explicit block or incompatible restrictions remain blocked. Reuse the existing restriction calculation; do not reinterpret the use labels as a numerical ranking. A need finding cannot broaden the contribution's permission. Historical examinations remain audit evidence, not an alternate calculation branch or invented per-need approval.

`domain/sources.ts` remains the shared projection and handoff owner. `controlledSourcesContributions` exposes actual contribution-level and per-need effective uses. `completeSources` associates a contribution only with needs for which its effective use is admissible; it can retain independent useful documentary material even when another association is blocked. A missing need association is not an answered question or established gap. Later `request_documentary_check` restrictions carry the same optional need scope and cannot loosen earlier restrictions. Retention, handoff, consultation, workspace inspection and advisory review consume this shared calculation.

Persist v2 with a server-stamped control version and `schemaVersion: documentary-control-v2` in the existing `aiTaskResults` output. The model does not select its contract version. Exact-control reuse includes the control contract version, immutable contributions/evidence/needs and existing rule/restriction identity. A new control is never substituted for a historical result merely because its prose seems equivalent.

Keep the v2 operation receipt compact: `taskId`, `controlVersion`, the existing context-event `reference`, effective contribution/need uses and objection count. Do not return both the full control and duplicated full diagnostics in the tool result. `retainControl` already records `contributions_qualified` with the control through `recordContextObservation`; expose that immutable event ID so `consult_mission_state({ reference })` can read full details using its existing paging and authorization. Recover the same reference after acknowledgement loss through the existing run/context-key identity. Current projections use bounded diagnostic previews with explicit completeness rather than repeating the complete need-by-contribution matrix everywhere. Retain complete diagnostics in the authoritative control/journal; do not silently trim them into successful findings.

Validate the actual complete control and prepared handoff against the existing domain-storage and operation-capacity owners before committing domain effects. A real capacity failure remains an explicit technical incomplete outcome with the original model response retained through the existing fragmented journal. Do not lower permissions, drop objections or recreate the recently removed aggregate generated-response rejection to fit a receipt. The compact receipt and existing paged history are the normal v2 path, not a second documentary reader.

### Counter, policy snapshot and native terminal evidence

Add one named resource-policy constant for the accepted 4,096-character run and one versioned `structuredOutputPolicy` snapshot. The snapshot contains its supported policy version and effective run threshold; it is fixed for admitted work and retained in invocation/receipt metadata. It is not a new budget or analyst-facing configuration. The current binding pins it when creating the preparation; retries inherit the original snapshot. Required metadata must be present before current work can dispatch; there is no missing-snapshot fallback to the old behavior. The transition below must resolve earlier active preparations without rewriting engaged policy pins. The existing authority deadline and resource-policy contract remain independently authoritative.

Inside `integrations/modelTransport.ts`, add a private lexical counter to the existing raw model-stream middleware before text packing. Its state is only `inString`, `escaped`, `visibleResponseStarted` and the current outside-string whitespace run. It observes text deltas; initial reasoning is not response text. Quotes, backslashes and the run survive fragment boundaries. Inside a string, even a very long space sequence never advances the counter. Outside a string, count exactly SP, TAB, LF and CR; every other character resets the run. This observer neither parses values nor repairs or validates JSON. The installed public SDK partial-output interface does not expose lexical string state, so using it alone is unsafe for open keys.

At exactly 4,096, abort through the existing generation cancellation signal with a typed `structured_output_whitespace` diagnostic. Retain the received raw diagnostic through the current visible-output writer, recording the counter policy and observed boundary. Do not delete or rewrite received characters, suppress usage, impose an SSE byte bound or report the guard as a syntax error. The existing settlement grace bounds capture finalization after interruption. The counter applies through the shared one-shot path for documentary examination, qualification and comparison whenever the pinned policy is present. It does not add separate implementations to each caller or change native Pi free-text/tool generation.

Use native terminal metadata rather than a second SSE parser. The installed AI SDK exposes `rawFinishReason`; its OpenRouter adapter preserves an actual `choice.finish_reason` as the raw reason, while EOF has no raw reason. A November 26 offline native-API probe returned `rawFinishReason=stop` for an explicit finish and null for EOF with otherwise valid JSON. Capture this at the existing provider-stream boundary and include it in the structured receipt. Add an optional `termination` union to `providerCalls.providerObservation`: `{ kind: finished, source: stream, rawFinishReason, observedAt }` or `{ kind: cancelled, source: generation_lookup, generationId, observedAt }`. A stream observation belongs to its admitted invocation/provider-call receipt; lookup cancellation additionally requires the exact external generation ID. Convert earlier cancellation observations once only where their retained identity and provenance establish this evidence; otherwise leave termination unknown. Remove the replaced cancellation interpretation after verification, retaining the original receipt for audit. Keep local abort reason separate. Recognized provider finishes establish termination, while the existing attempt policy decides whether that outcome is recoverable. Normalized `other`, local cancellation, a charge and an ID alone do not establish it.

### Reconciliation and conservative attempt admission

Extend `providerCalls.requestBilling`, `claimBilling`, the existing reconciliation action and settlement transaction to reconcile two independent facts: provider termination and cost. Neither request nor claim eligibility may skip an unresolved terminal outcome solely because a cost is already present. `integrations/openRouterGeneration.ts` validates the returned generation ID, can retain `cancelled: true` even when cost is missing/invalid, and validates any cost separately. `settleBilling` preserves terminal evidence and its source independently of the billing state; conflicts remain visible. Do not release an unknown-cost reservation just because cancellation is known.

`domain/sourcePreparationAuthority.ts` remains the single classification owner consumed by retry selection, preparation accounting and qualification accounting. Under the new policy, a confirmed provider-ended unusable response or a detector interruption with verified remote cancellation can be considered for the existing bounded recovery allowance. A terminal technical observation is not automatically an unrecoverable business failure. Analyst cancellation, stale authority, genuine resource exhaustion and disallowed failures remain ineligible. EOF without explicit terminal evidence remains unknown, including when a complete JSON object happens to be present. Preserve original failure diagnostics and receipts.

`providerCalls.nextPreparationAttemptForInput` and `recordAttempt` continue to enforce the same input's lifetime attempts, deadline, cooldown when applicable and cumulative budget atomically. The executor must respect a returned `retryAt` by scheduling through the existing operation owner; it must not spin or reset preparation identity. `qualificationUsage.ts` continues to retain the prior full reservation until eligible final cost settlement. Confirmed termination clears execution uncertainty without declaring a missing charge zero. The next attempt is admitted only if both reservations and all other cumulative charges fit. No accounting-only administrator action creates a new grant or revives a closed operation.

To cover worker loss after observing a generation ID but before `finishOneShot`, arm the existing reconciliation owner against the call's recorded lease/deadline when its identity is first persisted. No new arbitrary polling interval is introduced. Normal finalization reuses or advances that job through the current idempotent owner. A received result and eligible reconciliation scheduling remain atomic in `finishOneShot`. If no generation identity was retained, the operation cannot infer non-dispatch or issue another call.

While the new recoverable operation remains authorized and nonfinal, a temporarily unavailable lookup (including the observed generation-not-found response) schedules its next eligible reconciliation using the billing owner's recorded `retryAt` and attempt fence. The same owner prevents duplicate jobs and honors lookup timeout, existing cooldown and the logical operation deadline. This is bounded metadata recovery, not another generation or an indefinite watcher. A repeated missing result cannot become cancellation proof. After the recovery window ends, existing late-accounting/manual-reconciliation behavior remains separate and cannot revive inference.

### One scheduled operation with fenced continuation epochs

Extend the existing scheduled durable-operation contract with the concrete opt-in `scheduledRecovery: structured_model_v1`. Only eligible current operation definitions declare it; other durable operations retain their one-start behavior. The driver checks this declaration and receipt ownership, never the agent name. Replace `scheduledJobId` and `scheduledStartedAt` with one optional `scheduledExecution` record in `execution/schema.ts`, used by scheduled operations: epoch, phase (`queued`, `running`, `waiting_provider` or `finished`), job reference where applicable, start observation and, for structured recovery, policy version, active provider-call reference and first structured invocation reference. The parent native invocation field is not reused for the examination. Migrate retained scheduling facts once and preserve their start evidence. Non-recoverable operations still admit only their initial epoch; no caller reads or writes two live scheduling representations.

`execution/operations.ts` owns initial claim, `beginScheduledExecution`, continuation scheduling and final `recordResult`. Pass an epoch through the scheduled action signature. A worker atomically claims exactly its admitted epoch and cannot reuse a started one. A continuation increments the epoch and schedules the same declared action without clearing old start evidence or changing the logical request key. Observation of the scheduling record, cancellation and `operationHasStarted` consume the same current representation. There is no second scheduler, queue, retry daemon or agent-specific driver branch.

An eligible incomplete examination returns an existing `waiting` outcome while recoverable technical work remains. Do not commit a terminal unavailable outcome and later mutate it into success. Settlement of the associated provider call can request a fenced continuation wake. The scheduling mutation validates the call-to-operation link, current policy, nonfinal operation and generation before adding a job. The worker rechecks active authority, execution slot, pause, versions, attempts and budget before actual I/O. Duplicate acknowledgements or settlement events observe the current epoch rather than admit another worker. Existing deadlines still bound the logical operation; a new action does not renew mission authority.

`sourcesMission.reserve` distinguishes initial work reservation from authorized continuation of that exact request. The initial path retains its work/control consumption. The continuation path reuses it, verifies the retained input hash and versions, and bypasses neither source rejection nor current evidence checks. The immutable first examination input is already retained through its linked structured invocation; reuse that journal body and hash instead of adding another bulky work store. A resume must not use `request.invocationId`, which names the proposing agent's invocation, as if it named this separate structured call.

`sources/preparationModel.ts` returns either a known result, an explicit final failure or a pending recovery descriptor with the original call/input identity. `sourcesMissionActions.execute` and `sources/examineContributions.ts` route the pending result to the existing scheduled-operation owner. No extra Sources generation is needed to request the retry. Pause/resume may rebind authorized adoption through the existing generation mechanism; it cannot silently restart the original epoch or grant paid work while research is paused. A replacement attempt uses current authorized dispatch generation, retains the original logical artifact and receives a distinct provider receipt.

Recovery checks retained work before dispatch: first restore an existing final operation result; otherwise recover any already committed qualification/control; otherwise recover a complete retained one-shot result for domain adoption; only then consider another admitted model attempt. `sourcesMission.retainControl` must make control and qualification retention idempotent by the existing run/type/input-hash identity and provider-call ownership. Lost acknowledgement after domain retention cannot insert another qualification or repeat a model call. A later changed head/authority refuses stale adoption without overwriting the retained evidence. Original failure, response, control and operation outcome remain distinct records.

### A verified transition removes the replaced contracts

Introduce Sources v9 for the submission/check result contracts (operation version 3), carrying forward its native completion behavior, plus Workbench v13 and saved-material inspection v5 for their affected typed results. These replace the executable definitions that require the old documentary representation; they are not additional permanent catalogue variants. Keep the catalogue static and the current selector authoritative. Historical definition IDs, versions and invocation hashes remain audit identities, not aliases that silently resolve to different code.

Before cutover, inventory affected stored controls, projections, bindings, prepared profiles, queued jobs, resumable invocations and unsettled calls. Fence admission to the affected path while reaching a verified transition point. Already engaged invocations must finish or reconcile under their original authority before their executable definition is removed; an unknown external outcome for work that could still resume blocks that transition. Closed or expired work keeps its unresolved receipt and conservative accounting without retaining its old executor. Do not clear start markers, change immutable invocation pins, cancel analyst work or issue replacement inference to force cutover. A dormant dossier can receive a current binding only through an explicit transition that preserves its prior invocation records and existing authority; if that cannot be established, report a transition blocker rather than retaining an automatic fallback.

Use a task-scoped, resumable conversion in the existing persistence owners. Preserve original control bytes, quotations, identifiers, decisions, receipts and hashes through the existing journal/retained-text storage. Convert structural facts only; an old global verdict does not supply missing per-need findings. The current inspection contract must represent an assessment as unavailable when it has not been performed, with the original examination available through its audit reference. Preserve already completed handoffs and decisions as historical outcomes without replaying them or presenting them as newly examined. Reuse of material that requires a current examination follows normal admission; conversion itself triggers no model call. Completed historical observations use the existing history reader as recorded data rather than the old executable validator.

Update the single input/result selector used by runtime `modelOperation`, existing `nativeToolSets` variants, prepared model profiles and schema hashing together. Verify prepared/runtime contract-key equality for the current definitions. Update `domain/sourcesContracts.ts`, `domain/sources.ts`, `sourcesMission.ts`, `sourcesWorkspace.ts`, `domain/savedMaterialOperations.ts`, `domain/workbenchAgentOperations.ts` and `responseControl.ts` at their actual consumer boundaries. Shared documentary summaries expose scoped objections and effective uses, or explicit absence of a current assessment. Reader composition stays intact. Current runtime dispatch rejects unmigrated or inconsistent records explicitly instead of choosing an old schema or treating absent metadata as success.

Verify conversion completeness, preserved content hashes, settled/active work, current bindings and all consumer outcomes before removing transitional code. Then delete the converter, temporary widened validators, replaced definition/profile variants, old examiner instructions, old cancellation/scheduling fields and their fallback branches from the active build. Preserve evidence in data and version control. Removal is limited to contracts superseded by this correction; it does not authorize unrelated cleanup or deletion of historical data. Keep the Sources method package unless its content actually requires a change; update the semantic examiner's instructions in place. No rule depends on phrase matching or a model announcing that it has fixed itself.

### Required implementation verification and bounded delivery

Use test-first changes through the existing transport and Convex integration boundaries. Production tests import real owners and replace only provider HTTP and other nondeterministic external I/O. Add no parallel implementations or pass-through-only tests. Retained examples establish expected documentary use at the domain boundary, without requiring another architecture comparison campaign.

| Boundary | Required representative checks |
| --- | --- |
| Examination and domain disposition | Faithful attributed claim retained while an independent-outcome association is blocked; actual overstatement refused; one objection restricts only targeted material; illegal/missing/foreign identities reject the whole control; later restrictions cannot broaden use. |
| Transition and projections | One-time conversion is resumable and preserves original bytes, hashes, decisions and scheduling evidence; old global findings create no per-need approval; completed historical outcomes remain inspectable without replay; unresolved resumable work blocks cutover while closed uncertain receipts keep conservative accounting; current native profiles match runtime; Start uses current Workbench/Sources contracts; replaced validators, definitions, fields and converters are absent from the final active build. |
| Streaming counter | 4,095 continues and 4,096 interrupts; mixed JSON whitespace across fragments; non-whitespace reset; long valid strings and open string keys; escaped quotes and split backslashes; initial reasoning; received bytes retained; complete JSON followed by excessive whitespace is an interruption, not a syntax verdict. |
| Terminal evidence | Explicit finish versus EOF with the same valid body; detector abort versus verified provider cancellation; known cost without termination remains unknown; cancellation without cost retains its reservation; unavailable/not-found lookup then confirmation; wrong generation ID and conflicting observations cannot enable recovery. |
| Financial admission | Independently derived fractional-budget boundary, including both attempt reservations at equality and just below the required allowance; no released old reservation, lost charge or reset call count. |
| Durable recovery | Real scheduled continuation after reconciliation and across action lifetimes; pending cooldown schedules instead of spinning; duplicate wake/acknowledgement; worker loss before result, after result, after domain retention and before operation acknowledgement; one qualification and one final adoption. |
| Authority and shared scope | Pause/cancel, expiry, stale generation/instructions/evidence and lost visitor slot block new dispatch; permitted observation/late accounting remain factual; eligible qualification/comparison calls use the same counter/classifier; unrelated durable operations and native Pi loops preserve their existing contracts. |

Replay the captured whitespace through the real transport after the counter change and compare retained bytes and interruption outcome. This measures mechanics on real retained text with synthetic chunk timing, not upstream repair or historical latency. Exercise the final scheduled recovery and Sources handoff on the matching local backend after successful publication during implementation. Run focused tests first, then affected conformance, execution-ownership, type and documentation checks; run broader checks only when the changed boundaries require them. The final separately authorized qualification targets these corrected operations and honest partial outcomes, without a benefit study of the second model call.

Keep delivery as one coherent correction batch: stage the required schema changes, complete and verify the one-time transition, retire the replaced code and activate the current definitions and policy snapshots under the admission fence. Temporary conversion support is a delivery step, not a supported runtime mode or remaining completion item. Retained active work is not reset to make the new path runnable. Update current technical references only when the accepted contract is implemented and verified, preserving the historical failed qualifications. Program Design approval authorizes neither implementation, data migration nor paid execution.

## Patterns to Follow

- [Shared operations](../../../convex/execution/operations.ts): atomic admission and scheduling, retained outcomes and generation-fenced adoption. Extend their lifecycle rather than adding a retry scheduler.
- [Model transport](../../../convex/integrations/modelTransport.ts): native SDK parsing, exact visible-output capture and transport-owned cancellation. Native partial values remain diagnostic and cannot be adopted as final results.
- [Attempt authority](../../../convex/domain/sourcePreparationAuthority.ts), [provider receipts](../../../convex/providerCalls.ts) and [campaign accounting](../../../convex/qualificationUsage.ts): existing lifetime attempts, external observations and conservative financial reservations.
- [Sources integration tests](../../../src/__tests__/convex/sources/documentary-control-integration.test.ts): real dispatch, persistence and domain adoption, replacing external I/O only. The research probes characterize defects; future correction tests must assert the intended behavior instead.

## Scope

Improve submission-time documentary examination, scoped restrictions, generation interruption and safe recovery under the current shared harness. Preserve native Pi generation/compaction, Convex authority, evidence integrity and OpenRouter's default routing with its existing price guards. The accepted initial detector threshold is 4,096 consecutive outside-string JSON whitespace characters. Retire the replaced code after a verified one-time transition; no maintained legacy execution or compatibility mode is selected. No new inactivity duration, transport migration or expanded resource allowance is selected. Measuring the second examination call's incremental benefit is outside this prototype correction. Sources state/history efficiency remains the separate request in document 22. Paid mandates remain closed.
