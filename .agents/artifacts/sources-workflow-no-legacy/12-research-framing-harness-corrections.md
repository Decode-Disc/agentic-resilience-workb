---
date: "2026-11-20T08:51:00+01:00"
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "a18e82a71de38db7fe34cba75e51447129e19464"
topic: "Framing contracts, execution stops and documentary continuity"
type: research
tags: [research, framing, execution, provenance]
status: complete
flow: tdd
---

# Research: Framing harness contracts

## Scope and method

This report answers the five [research questions](11-research-questions-framing-harness-corrections.md): state-dependent framing inputs; non-progress accounting and consumers; independent execution controls; documentary reference lifetime; and regression coverage. The separate [request](10-request-framing-harness-corrections.md) owns the desired changes. This document describes current behavior; it does not select or implement the correction.

Evidence consists of current source inspection, the retained [activity excerpt diagnosis](../../../docs/verification/2026-11-20-activity-excerpt-diagnosis.md), the [live comparison](../../../docs/verification/2026-11-20-task-method-live-comparison.md), one new temporary integration probe and fifteen selected existing tests. One read-only research agent traced shared stops and independent controls; its findings were reconciled with the main investigation. No new inference, network research, deployment, dependency change or paid qualification was performed. All provider boundaries exercised by tests were mocked. The checkout contains pre-existing modifications; the [source manifest](framing-research-source-manifest.json) records the current revision and sixteen source hashes, not a clean qualification snapshot.

## The three concerns meet at operation settlement but have different owners

The model-facing framing schema accepts a missing activity anchor that the initial-open business path rejects. Normalization does not remove the field, and retained requests prove the model received both refusal messages. The interface expresses the syntactic union; the conditional obligation lives in the business operation.

The non-progress threshold counts settled invocations, not identical actions. It can stop a mixture of refusals, retained readings and state consultations. Budgets, authority, cancellation and effect identity operate independently, but they do not replace this early stop with an equivalent measure of useful work.

A provisional save changes the revision used by three documentary checks: candidate selection, read continuation and fresh reading association. Existing saved associations have a separate inheritance path. The new probe reproduces post-save failures through the real operation boundary while preserving the observations and draft.

```text
Model arguments
  → projected schema validation
  → message/revision normalization
  → canonical request and operation identity
  → domain authority, execution and retained outcome
  → adoption and progress settlement
  → native continuation or technical stop
  → domain completion and publication checks
```

## The shared schema does not encode the conditional activity-anchor rule

[`framingContracts.ts`](../../../convex/domain/framingContracts.ts), line 21, declares `provisionalOpenEvent.activityExcerpt` optional. [`workbenchContracts.ts`](../../../convex/domain/workbenchContracts.ts), lines 98–110, builds the native directed input with optional `eventBasis`. [`workbenchAgent.ts`](../../../convex/domain/workbenchAgent.ts), lines 190–220 and 632–726, selects the versioned schema, hides mechanical revision fields, binds the uniquely active message and supplies the observed revision. It does not currently project different anchor requirements for empty and populated scopes.

The state-dependent behavior is split between entry handling in [`framing.ts`](../../../convex/framing.ts), lines 357–469, and provenance validation in [`framingProvenance.ts`](../../../convex/domain/framingProvenance.ts), lines 214–375:

| Incoming open proposal | Current behavior |
| --- | --- |
| Initial nonblank scope, missing anchor, Workbench v6/v7/v8 | Refused at `eventBasis.activityExcerpt`; neither a scope containing the analyst's words nor an excerpt nested in a condition supplies this field. |
| Supplied anchor | Must be nonblank and occur verbatim in the active message, unless inherited with the unchanged scope and prior anchor. It must also occur in the proposed scope. |
| Populated unchanged scope, missing anchor | Can be valid, subject to the entry rules and condition provenance. A bare `{kind: "open"}` inherits only an existing open basis with identical complete content; it cannot silently replace an existing program. |
| Changed scope, missing anchor | Refused. Entry handling can produce `framing_open_preserve_program` for a bare open proposal; the structured provenance path reports the missing relationship. |
| No basis, unchanged existing open scope | The entry point can inherit the current open basis before validation. |
| Retained v4 or bare initial v5 open proposal | The legacy generic provisional-program branch remains. V5 structured proposals use the directed provenance validator. |

Directed framing is explicitly supported by versions 5–8; corrected initial framing behavior by versions 6–8 (`workbenchContracts.ts:388–395`). A universal storage requirement would therefore describe neither every valid update nor every retained version.

The exact received JSON is validated against the offered schema before normalization, then against the canonical operation union before persistence (`execution/invocationLifecycle.ts:1395–1477`). The same validators feed SDK tool metadata through `agentToolSchemas` and `piToolMetadata`. Business validation executes later, against current stored state. This explains how schema reuse and typechecking coexist with the observed mismatch: sharing the structural declaration does not establish equivalence with every state-dependent business rule.

Feedback has two owners. The missing-field validation path is precise, but its current sentence also asks for inclusion in `content.scope`; the definition's diagnostic then lists all event-basis alternatives (`framingProvenance.ts:261–270`, `workbenchAgent.ts:441–449`). `modelOperationOutcome` preserves the typed outcome and adds that diagnostic (`execution/agentDefinition.ts:184–215`). The retained failed correction changed only the scope. Feedback ambiguity is a plausible contributor; its causal effect on the model was not isolated.

### Tool preparation already supports variants, with calibrated identities

`nativeToolSets` enumerates availability and message-cardinality variants; `modelOperation` projects the actual snapshot (`workbenchAgent.ts:360–405,632–670`). [`piModelProfiles.ts`](../../../convex/integrations/piModelProfiles.ts), lines 169–197, prepares those variants across admitted reasoning settings. [`modelInput.ts`](../../../convex/integrations/modelInput.ts), lines 22–36 and 382–430, serializes the same tool metadata and includes it in the profile hash. Missing calibration fails explicitly with `model_input_profile_unavailable` at lines 471–480. Native tools are built from the projected declarations in `piMission.ts:310–328`.

These are existing integration points, not a technical prohibition on a more precise schema. Their current input dimensions do not include the conditional initial-open requirement. Any later design must account for the offered schema, finite prepared variants, retained definition versions and actual serializer together; changing one declaration alone is not evidence that all consumers agree.

## Non-progress settlement is shared across agent versions and drivers

[`invocationProgressSettlement`](../../../convex/execution/invocationLifecycle.ts), lines 1503–1571, compares adopted progress with the invocation's admission snapshot. `MAX_NO_PROGRESS_TURNS` is three (`resourcePolicy.ts:157`). Settlement is idempotent through `lastSettledInvocationId`.

| Settlement condition | Counter and recovery marker |
| --- | --- |
| New adopted progress keys | Reset to zero and clear the recovery marker. |
| Only successful, adopted `contextRead` requests originating in this invocation | Preserve the counter. |
| First qualifying restoration after a recorded refusal | Preserve the counter and mark restoration consumed. |
| Other invocation without new progress | Increment once, irrespective of tool-call count. |
| First completion refusal with no prior recovery marker | Cap the count below the threshold once, retaining feedback for correction. |
| Count reaches three | Persist `blocked / repetition_stop` and `repetition_stopped`; native settlement prevents another generation. |

Only the registered skill `read` declares `contextRead`; a reused completed page retains its earlier invocation identity and loses that exemption. Saved-material search and contextual reading declare `materialRead`, which can qualify for one restoration. Public-context reading does not declare that flag. Restorable history fragment IDs can instead add genuinely new progress and reset the streak. These roles are distinct (`execution/agentSkills.ts:40–75`, `domain/savedMaterialAgentOperations.ts:122–130`, `execution/operations.ts:1093–1140`).

`consult_run_state` returns current state without progress facts or either exemption flag (`execution/commonOperations.ts:71–121`). In the retained CCC failure, history consultation reset the count; a previously observed reading, repeated search and state consultation subsequently advanced it from zero to three. The two rejected writes did not directly carry their count into that final streak.

Shared settlement applies to ordinary Workbench v4–v7, Sources v4/v5 and the registered validation/inspection definitions, plus qualification controls Workbench v8 and Sources v6. The retained Workflow driver calls the same mutations; native Pi settles the last returned batch before requesting further generation (`execution/agentCatalog.ts`, `execution/missionWorkflow.ts:239`, `integrations/piMission.ts:510`). This is not a v7-only policy.

The stop has downstream consumers. `generationInterruption` classifies it as `repeated_failure`; Sources handoff/recovery uses that classification, while qualification recognizes a blocked case only after worker, effect and accounting checks. Native publication requires a completed mission result. A different request key cannot recreate the same blocked objective; internal resume preserves accounting state, and queue resume alone does not reopen a blocked active mission (`execution/missionData.ts:27`, `execution/missions.ts:132`, `execution/handoffs.ts:145`, `sourcesMission.ts:1063`, `execution/conversations.ts:503,782`, `execution/fixtures.ts:1937`).

The separate worker-local preparation counter raises `native_preparation_stalled` after three preparation mismatches, potentially before any provider call (`piMission.ts:224–233`). It detects changed prepared input, not absence of domain progress. Writer leases, generation deadlines and the 256-fact storage boundary are also separate mechanisms.

## Independent controls bound work but do not prove that another turn is useful

| Control | Scope, unit, source and exhaustion behavior |
| --- | --- |
| Ordinary model allowance | Both Workbench and Sources reserve from the dossier's cumulative work/incident ledger, including mission-bound compaction. Defaults are 120 productive calls and 40 confirmed incidents, with validated overrides; pending or unknown reservations remain counted. Exhaustion yields `work_budget_exhausted`, `incident_budget_exhausted` or `model_attempt_limit_reached`. Owners: `providerCalls.ts:1350–1414`, `domain/sourcePreparationAuthority.ts:107–195`, `qualificationUsage.ts:215–250`, `resourcePolicy.ts:577–594`. |
| Qualification financial grant | Additional immutable lot/case USD and request ceilings govern qualification. Confirmed costs settle reservations under `known_final_v1`; unknown, conflicting or overrun outcomes fence further dispatch. This financial branch is distinct from the ordinary dossier call ledger. Owners: `providerCalls.ts:92–164,1445–1537`, `qualificationUsage.ts:38–65,137–205`. |
| Documentary allowance | Workbench pins configured search/read attempt counts; missing or exhausted allowance is explicit. Sources has its persisted preparation envelope and phase-specific discovery/acquisition capacity. Frozen replay performs no documentary provider I/O. Owners: `workbenchPublicContext.ts:59–77,197–252`, `providerCalls.ts:1203–1223`, `domain/sources.ts:63–164`, `sourcesMission.ts:205–276`. |
| Time and worker ownership | Dispatch uses the applicable mission/preparation/grant deadline and Node host deadline. The default mission window is 15 minutes; the 600-second host window reserves 10 seconds for settlement. Writer leases renew every 25 seconds against a 90-second lease. Interrupted worker slices and expired mission authority have different settlement paths. Owners: `execution/missions.ts:149–173`, `resourcePolicy.ts:11–55,136–157`, `execution/invokeAgentModel.ts:131–143,432–503`, `integrations/piMission.ts:924–949`. |
| Authorization and freshness | Current mission generation, active turn/instructions, execution status and operation pins are checked at their applicable admission and adoption boundaries. Start fixes framing and claims the research slot; public Resume rechecks prerequisites. Cancellation invalidates running authority before cleanup. Owners: `execution/authority.ts:59–203`, `domain/runCancellation.ts:16–62`, `execution/researchControl.ts:553–615`. |
| Reuse and uncertain effects | Stable operation identity reuses completed outcomes; scheduled effects have a once-only start marker. Running/unknown effects cannot be blindly executed again. Confirmed non-dispatch can be readmitted; unknown model dispatch retains its reservation. Receipt settlement can record late costs without granting stale adoption. Owners: `execution/missionData.ts:119–157`, `execution/operations.ts:390–583,665–905,1031–1091,1317–1479`, `execution/invokeAgentModel.ts:431–555`. |

In the traced paths, the non-progress threshold is the early stop for serial invalid proposals, repeated retained results or state consultations while other authority and capacity remain valid. Effect reuse can prevent another acquisition while model calls still consume the allowance. The ordinary call ledger and deadlines remain independent bounds; they do not make continued reasoning productive. No separate application inactivity timer was identified in the native generation path examined. The Workbench 128-operation check occurs at completion, and the 256-fact ceiling does not advance on duplicate facts; neither is an equivalent repeated-call admission rule (`workbenchAgent.ts:544`, `execution/progress.ts:12`).

## A save invalidates reference freshness without deleting the observations

[`requirePublicContextRequest`](../../../convex/workbenchPublicContext.ts), lines 81–175, first checks the active request, generation, mission, instructions, framing lifecycle and current request pin. A candidate read then independently requires the search to belong to the same mission, dossier, message, instruction version **and current framing revision**, with a successful adopted outcome and valid candidate index. Lines 320–350 impose corresponding conditions on a continuation, also requiring an identical target and retained document/range metadata.

The public operation pins the current revision at enqueue and rechecks effect-pin freshness at adoption (`domain/workbenchAgentOperations.ts:383–425`). The pin participates in protocol operation identity (`execution/missionData.ts:119–157`). Thus a read requested after a save can have a valid new request pin while its referenced search fails the older-revision check. The save itself does not erase the search or read.

```text
search at revision 1 → adopted candidate list
read at revision 1   → retained document and passage
save open program   → revision 2, same active message and instruction version
  ├─ read another candidate from old search → unavailable / source_reference_not_observed
  ├─ continue old candidate reading         → unavailable / source_reference_not_observed
  └─ newly cite old reading in a draft      → refused / framing_public_lookup_invalid
```

The first two outcomes come from the public-context action's conversion of typed execution errors to `unavailable` (`workbenchPublicContextActions.ts:870–881`). Candidate index errors, foreign/unadopted observations, revision mismatch, invalid continuation and an unobserved supplied URL share `source_reference_not_observed`. No dedicated Workbench diagnostic distinguishes those causes; the shared renderer supplies generic prerequisite guidance (`agentDefinition.ts:184–215`). This is coarser than the available underlying state.

Fresh public associations require adopted readings for the current message, instruction version and revision (`framingProvenance.ts:81–137`). An unchanged saved public basis with identical scope inherits without that fresh-association check (`:140–157`). An unchanged conditional association inherits only when scope, question text, hypothesis and basis match (`:340–375`). Historical reference projection rehydrates retained passages without granting current-turn authority (`:68–78,378 onward`). Reading access, new citation authority and historical display therefore already have different paths.

| Change in authority | Existing behavior |
| --- | --- |
| Agent saves a provisional draft | Advances framing revision without incrementing the turn's instruction version. The revision tests alone can invalidate prior observations. |
| Analyst directly edits the draft | Advances framing revision and the active instruction version. Edit authority also protects analyst-changed scope, question content/order and deletions against the original message's receipt revision. |
| Steering or a new active turn | Instruction or mission/message membership checks apply independently of revision. |
| Cancellation or stale generation | Mission authority fails before documentary use can advance the dossier. |
| Foreign or unadopted reference | Membership/adoption checks refuse it; an observed URL alone does not confer reading authority. |

The distinct analyst-edit behavior is explicit in `framing.ts:306–351`; original-message protection is in [`framingEditAuthority.ts`](../../../convex/domain/framingEditAuthority.ts), lines 29–147. The permitted future lifetime across these changes is a design decision. The current code does not distinguish an agent-only revision change when checking candidate or continuation freshness.

## Executable checks confirm current behavior, not the proposed correction

The new [probe source](framing-continuity-research.test.ts.txt) imports the real v7 fixture, schema, operation enqueue/dispatch and framing query; only Exa HTTP responses are mocked. It performs search → first read → save open draft → unread candidate → continuation → new public citation. It checks retained adoption, same mission/instruction identity, different revision pins, unchanged saved revision 2, no extra provider calls and no Sources start. It is a reproduction of present behavior, not a test accepting that behavior as the desired contract.

Its first run failed because the probe expected `refused` for the documentary outcome; the real action returns `unavailable`. Source inspection confirmed the conversion. The corrected characterization passed. The initial output is preserved in [first-probe log](framing-continuity-first-probe.log); the successful output is in [probe log](framing-continuity-research.log). The temporary executable was removed from `src/__tests__/` after preserving its source. No production file changed.

| Checks run in this research | Observed result |
| --- | --- |
| `pnpm exec vitest run src/__tests__/convex/execution/framing-continuity-research.test.ts` | One characterization passed after the outcome-kind correction above. |
| `pnpm exec vitest run src/__tests__/convex/execution/workbench-framing-receipts.test.ts src/__tests__/convex/execution/workbench-native-interface.test.ts -t 'initial open framing refuses missing activityExcerpt\|selected publication reaches a later passage\|selected publication replay reaches the native repetition stop\|independent read provenance\|a direct analyst edit survives stale output'` | Thirteen selected tests passed; 83 excluded by the name filter. [Log](framing-research-existing-tests.log). |
| `pnpm exec vitest run src/__tests__/convex/execution/workbench-native-interface.test.ts -t 'exhausted cumulative work budget blocks initial correction\|stopping a native response settles its cancelled tasks'` | Two selected tests passed; 52 excluded by the name filter. [Log](framing-research-resource-tests.log). |

The existing suites use `convex-test` with real internal collaborators. Native tests run Pi with scripted provider responses; they establish continuation, persisted effects and publication behavior under those responses, not what a live model chooses.

Additional coverage was **read, not run** in `src/__tests__/convex/execution/`: registry-wide operation conformity (`operation-conformance.test.ts:137`), one-shot restoration and settlement idempotency (`bounded-refusal-recovery.test.ts:8`), repeated completion failure (`workbench-framing-completion.test.ts:166`), preparation mismatch before dispatch (`workbench-native-admission.test.ts:298`), native unknown/late/compaction/deadline paths (`pi-native-transport.test.ts:965 onward`) and qualification finance (`qualification-v2.test.ts:558 onward`). Profile/serializer coverage lives in that directory's `pi-input-capacity.test.ts:226,490,519` and `native-profile-identity.test.ts:4`.

Sources coverage was also **read, not run**: ordinary ledger contention and unknown reservations in [source-preparation-budget.test.ts](../../../src/__tests__/convex/sources/source-preparation-budget.test.ts), line 92 onward; scheduled cancellation and late billing in [documentary-control-integration.test.ts](../../../src/__tests__/convex/sources/documentary-control-integration.test.ts), line 316 onward; and time-limit settlement in [sources-time-limit.test.ts](../../../src/__tests__/convex/sources/sources-time-limit.test.ts), line 105 onward.

The conformance suite checks registered bindings, refusals, replay, capacity and authority. It does not establish schema/business equivalence across every framing state, nor run the complete search/save/read/native completion sequence for each definition. Existing public-provenance tests explicitly reject a wrong revision and preserve already saved associations. Those properties can all pass while a valid search becomes unusable after the agent's own save.

## Reference ownership and remaining evidence gaps

The owning technical passages are [TECH](../../../context/TECH.md)'s shared execution limits, tool inputs and framing authority, native task skills, public context during framing, context recovery/accounting and loop prevention (`:68,76–78,88,106,165,190–200,283 onward`). They currently document the threshold, context-page treatment and revision-bound provenance. [ROADMAP](../../../docs/ROADMAP.md), lines 53–57, already distinguishes implemented structural controls from unresolved reference/recovery and semantic qualification. The historical [resource-policy inventory](../../../docs/verification/2026-11-10-resource-policy-inventory.md), line 83, marked the numerical non-progress threshold for investigation. No current contract or historical evidence was rewritten during research.

The current ownership and failure mechanisms are established sufficiently for technical design. Verification limits remain:

- The new probe exercises the candidate continuation path, where the stale-search check runs first. The independent supplied-link continuation revision check is established by code inspection, not a separate executable reproduction.
- The exact captured v7 refusal sequence has not been replayed end to end through native settlement in this research. Prior wire evidence establishes delivery and the observed sequence; selected tests establish individual mechanics. A future correction still needs the full counter/history/effect/publication regression.
- Individual tests cover ordinary ledger boundaries; no new cross-phase test here proves Workbench → Sources → documentary control on the same dossier at its last available model unit.
- No live evidence establishes that a more precise schema, clearer diagnostic or removed threshold will make the failed model complete correctly. The retained semantic attribution errors and Sources usefulness remain separate qualification questions.

`pnpm docs:check` completed with 64 Markdown files, 384 local links and zero errors; the existing TECH word-count advisory remains. Artifact links were checked separately because the repository checker does not scan this working directory. Documentation review kept current normative requirements in their existing owners, preserved historical reports and distinguished this reproduction from the earlier qualification.

Full typechecking, build, browser checks, backend publication and paid evaluation were not run because this phase changed only research artifacts and temporarily executed a local diagnostic. Technical design remains the next phase.
