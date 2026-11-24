---
date: "2026-11-24T09:34:50+01:00"
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
topic: "Legacy retirement and effective agent definition resolution"
type: research
flow: tdd
tags: [research, execution, versioning, legacy-retirement]
status: complete
---

# Research: Legacy Retirement and Agent Version Resolution

## Research questions and method

This answers [the seven research questions](34-research-questions-legacy-retirement-version-resolution.md): version selection, dependent identities, obsolete launch behavior, shared execution dependencies, retained deployment state, purpose migration, and verification coverage. Findings describe the code at the recorded revision on `sources-workflow-no-legacy`. Direct source inspection and existing deterministic integration tests establish code behavior. The local deployment status check failed because its backend was stopped; deployment inventories remain unverified. No production code, data, environment, dependencies, or Git history changed.

## Summary

`getAgentDefinition` already owns exact definition lookup and named current definitions. The scattered knowledge is **which version a caller should request**: conversation creation chooses a qualification override or current definition; turn admission interprets conversation pins; mission creation independently interprets those pins, qualification overrides, and backend compatibility. Continuation generally consumes the stored mission version. A shared selection policy therefore has an existing catalog to build on; merely wrapping its lookup would leave the duplicated decisions intact.

The earlier launch finding has changed: fresh `researchLaunch.confirmAndStart` requests now fail with `framing_required`; historical reservation replay remains. Old mission and corpus-review drivers are still executable, but they share storage, generation, preparation, and recovery code with current Pi/Sources work. Removing whole modules or the Convex Agent component would remove current functionality.

All 171 tests run during this research passed across 11 suites. These results establish the selected local integration behaviors, not deployed readiness or absence of pending work. The November 22 inventory remains dated evidence. The documented guarantee that old executors remain runnable, the fate of existing conversations, and continued qualification comparisons remain decisions for technical design.

## 1. Lookup is centralized, but effective version selection is distributed

The catalog's current bindings are Workbench 12, Sources 8, saved-material inspection 4, conversation validation 3, and execution validation 3. Registered retained versions are Workbench 4–12, Sources 4–8, inspection 2–4, and both validations 2–3. Exact unsupported lookup throws `definition_version_conflict`. The schema accepts numeric versions, allowing historical rows to remain representable independently of executable registration. See [agentCatalog.ts:48](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:48), [supported registrations:159](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:159), and [agentSchemas.ts:21](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentSchemas.ts:21).

| Caller | Selection rule today | Persistence and downstream use |
| --- | --- | --- |
| `getAgentDefinition(id, version?)` | Exact requested version, otherwise explicitly named current binding | Returns bound operations, skills and contracts; does not write |
| `defaultDefinitionVersionForBackend` | Maximum registered version; excludes native completion definitions for non-Pi backends | Supplies mission default; different rule from named current binding |
| `ensureDossierConversation` | Existing conversation unchanged; new framed dossier gets authorized qualification version, otherwise current Workbench | Saves conversation definition ID/version; non-framed storage conversation can lack them |
| `startTurn` | Matching conversation ID uses its saved version, with missing version interpreted as 1; native conversation without matching binding also uses 1; otherwise current | Validates before turn admission; mission creation then resolves again |
| `missions.start` | Matching turn conversation pin first; otherwise qualification override; otherwise backend-compatible default | New mission saves definition version, backend, protocol and runtime; existing request/objective returns retained mission under identity guards |
| Child mission handoff | Parent's pinned operation authorizes child definition ID and scope; child inherits backend, not parent's definition version | `missions.start` selects the child's applicable version |
| Resume, Pi execution, context, operation execution, invocation adoption | Exact stored mission version | No automatic latest-version upgrade; adoption also compares invocation and mission pins |
| Qualification comparison | Valid active browser-test campaign authority selects Workbench 8/Sources 6 control or Workbench 7/Sources 5 native arm | Both conversation creation and mission admission consume this policy |

Selection sources: [conversations.ts:327](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/conversations.ts:327), [turn admission:1002](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/conversations.ts:1002), [missions.ts:41](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:41), [handoffs.ts:59](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/handoffs.ts:59), and [qualificationAgentMethods.ts:11](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationAgentMethods.ts:11).

Two details affect future centralization. First, backend selection uses `Math.max`, while ordinary catalog lookup uses an explicit current binding. These currently agree for Pi, but are separate maintenance rules. Second, mission admission resolves the candidate before checking an existing request; replay retains the previous mission rather than replacing its version. Moving resolution around replay checks can therefore change refusal behavior. Missing conversation versions deliberately resolve to unsupported version 1 and refuse, rather than silently selecting current Workbench. Queue admission retains that failure; stopping an unsupported old conversation remains possible.

Current tests exercise default conversation pinning, unsupported conversation continuation, non-Pi inspection 3 versus Pi inspection 4, and authorized comparison pins. Sources: [workbench-continuity.test.ts:15](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/workbench-continuity.test.ts:15), [retained-workbench-control.test.ts:11](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/retained-workbench-control.test.ts:11), and [operation-conformance.test.ts:430](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/operation-conformance.test.ts:430).

## 2. The selected definition binds several independently versioned contracts

| Identity | Current owner and relationship |
| --- | --- |
| Agent definition | Catalog selects instructions, operations, skills and completion contract; mission/invocation pins must agree for retained-response adoption |
| Operation contract | Request stores operation version from the selected definition; execution validates that version and arguments |
| Execution protocol and backend | New missions use protocol 3 and Pi backend/runtime 1; these numbers do not identify an agent definition |
| Framing acknowledgement | Historical operation returns a numeric revision; receipt operation returns retained JSON including the framing outcome |
| Saved-material binding | Explicit version bindings choose legacy or referenced material contracts; these are wire semantics, not current-version defaults |
| Skill package | Definition binds package identity/version and resources; resource hashes protect the admitted content |
| Model input profile | Key combines definition version, instructions/rendering, tools, completion contract, route/model settings and capacity; profile identity is not a single definition number |

The distinction is observable in [framing.ts:366](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/framing.ts:366): acknowledgement shape follows `request.operationVersion`, and replay returns its retained effect. Updating only the caller's expected result would break a successful domain write at result settlement. [operations.ts:339](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/operations.ts:339) allows retained completed common-consultation receipts across the specific supported mismatch case, while pending mismatches fail; this is narrower than arbitrary cross-version replay.

[savedMaterialOperations.ts:426](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterialOperations.ts:426) maps semantic bindings. [agentSkills.ts:57](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentSkills.ts:57) resolves skills through the pinned mission. [authority.ts:50](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:50) verifies response adoption identity. These owners cannot be replaced by a global latest-version constant.

[modelInput.ts:398](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelInput.ts:398) constructs profile keys; absent profiles fail as `model_input_profile_unavailable`. [piModelProfiles.ts:173](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piModelProfiles.ts:173) enumerates registered definitions. The generator's test preserves retained and active baseline profiles before writing updates. It was inspected, not run or regenerated in this phase. One-shot invocations also have `definitionVersion`, but derive it from the provider receipt's workflow version, rather than looking up an agent default ([invocationLifecycle.ts:909](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:909)).

## 3. Fresh obsolete launch is blocked; historical replay and an internal starter remain

```text
Current UI company confirmation
  framing.confirmCompany
    researchLaunch.confirmAndStartReserved(framingOnly: true)
    initializeFraming
  framing.startResearch
    authority + framing + quota + slot + Sources configuration
    researchWorkflow(sourcesEnvelope) → Sources mission

Retained public researchLaunch.confirmAndStart
  matching old reservation → return existing dossier
  fresh request → framing_required

Internal workflowControls.startReserved
  legacy reservation guards → researchWorkflow(no Sources envelope)
```

[researchLaunch.ts:61](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/researchLaunch.ts:61) checks replay before rejecting fresh non-framed creation. Framed confirmation persists company/preflight provenance and validated manual references without consuming analysis quota or starting research. [framing.ts:145](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/framing.ts:145) performs current Start atomically, returns an existing same-key start, and consumes one analysis for ordinary research. Authority refuses withdrawn dossiers; shared Start admission checks framing, quota, question capacity and the visitor execution slot. Missing Sources configuration leaves research state and quota unchanged.

Repository search found no production caller of [workflowControls.startReserved:16](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/workflowControls.ts:16), but the withdrawal regression calls it. A queued deployed invocation remains possible until inspected. The old public API still supplies the `CoveragePreset` type in [research-copy.ts:7](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/lib/presentation/research-copy.ts:7) and a test-helper argument type. Current UI calls `framing.confirmCompany`.

The executed launch, framing and workspace suites cover fresh refusal/replay, confirmation versus Start, idempotent charging, missing configuration, concurrent-start exclusion, withdrawal, and preflight/manual-reference controls. The earlier proposal to remove an API that launches fresh legacy work must therefore be restated: deletion would now retire historical replay and stale naming/types, not fix the already-blocked fresh launch.

## 4. Old executable paths coexist with shared current dependencies

| Retained path | Concrete reachability | Current dependency that prevents blanket deletion |
| --- | --- | --- |
| Workflow agent driver | `missions.resume` dispatches non-Pi missions to `missionWorkflow.run` or `runV3` | Pi imports controlled generation from `invokeAgentModel`; delete old branches only if retired |
| AI SDK / Convex Agent mission backends | `invokeAgentModel` resolves explicit or historical backend through `agentBackends` | Current documentary-control one-shot calls still use AI SDK streaming |
| Convex Agent component | Historical agent generation uses it | Current conversation storage and messages also use `components.agent` |
| Corpus-review preparation | `startForReview`, proposal rebuild/recovery, old review instructions, manual-candidate review branch and evaluation call preparation | Sources mission uses `claimForDiscovery`; qualification, persistence and preparation primitives are shared |
| No-envelope research workflow | Internal reserved start and retained orchestration can enter the old review loop | Current recovery uses the separate `reattachSources` branch without an envelope; Workflow remains current research orchestration |

Execution sources: [missions.ts:406](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:406), [invokeAgentModel.ts:192](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invokeAgentModel.ts:192), [agentBackends.ts:79](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/agentBackends.ts:79), and [agentStorage.ts:58](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/agentStorage.ts:58). Unsupported Pi backend versions refuse at admission; unresolved old backend identities block at generation resolution. An absent historical backend field has a compatibility default, not evidence that the row was Pi.

Preparation sources: [sourcePreparation.ts:127](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcePreparation.ts:127), [sourceSelectionProposalActions.ts:172](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceSelectionProposalActions.ts:172), [workbench.ts:1222](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/workbench.ts:1222), and [sources.ts:643](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources.ts:643). The direct-discovery fallback remains in proposal actions. [sourcesMission.ts:114](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMission.ts:114) and [runRecovery.ts:119](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/runRecovery.ts:119) establish current shared callers.

The current one-shot chain is `examineContributions → executePreparationModel → documentaryControl → invokeOneShot → streamText`. `beginOneShot` uses the misleadingly named `LEGACY_AGENT_BACKEND` for this current AI SDK identity. Naming alone cannot establish dead code. Executed one-shot and Sources reopen tests cover retained settlement and recovery; they do not establish that old scheduled targets are unused.

## 5. Current deployment dependencies could not be inventoried

On November 24 the authorized Convex status tool returned: `Local backend isn't running. (it's not listening at http://127.0.0.1:3210)`. No backend was started and no alternate connector was used. No current deployment selector or inventory was obtained. Production state remains unknown; previous production read restrictions were not bypassed.

The following is **November 22 evidence supplied by the earlier fully paginated local audit**, not refreshed counts:

| Record family | Dated observation | What it establishes and does not establish |
| --- | --- | --- |
| Research dossiers | 244: 174 browser tests, 68 evaluations, 2 research | Both real dossiers remain relevant; idle framing without Sources protocol is normal before Start |
| Missions | 76, all Pi runtime 1 / protocol 3 | Does not establish absence of queued research/preparation Workflows |
| Research mission pins | 23 Workbench 4; one blocked Sources 4 | Continued execution would depend on those contracts; blocked does not mean disposable |
| Conversations | 43, including 2 real research conversations on Workbench 4 | No evidence authorizes upgrading or deleting their pins |
| Preparations | 153: 144 non-mission technical records, 9 Sources mission records | Old preparation machinery had technical consumers; terminal versus pending work still needs inspection |
| Invocations | 436: 414 Pi, 22 AI SDK, all returned | AI SDK identity includes current one-shot work, not only an obsolete executor |

One technical Workbench 8 mission was running in that inventory. The comparison capability still explicitly selects Workbench 8/Sources 6 and Workbench 7/Sources 5 in current code. Terminal data, executable comparisons, continuing conversations, unfinished operations, scheduled functions and Workflow component state must be inventoried separately before removing their support.

Read-only access also has dependencies: [missionHistory.ts:71](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionHistory.ts:71) resolves a definition for a history projection. Keeping schema values alone does not prove every inspection surface survives registration removal. Conversely, unsupported-conversation stop tests show cancellation can work without restoring executable support. Newer definition objects also spread older implementations, so removing a registered version does not automatically make its base object dead code.

## 6. Purpose migration is local-only; the purpose domain remains current

[schema.ts:371](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/schema.ts:371) requires `researchRuns.purpose`. `runPurposeValidator` and `RunPurpose` remain active domain contracts for workspace isolation and human quota accounting. [runPurpose.ts:12](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/runPurpose.ts:12) also contains the historical classifier, which preserves explicit purpose and otherwise infers from provenance, marking ambiguous research candidates for review.

[adminOperations.ts:546](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/adminOperations.ts:546) restricts preview/migration to loopback deployments. Preview is paginated; migration bounds batches, skips populated records, refuses ambiguous classification, and records changes. Repository search found classifier/backfill use in these migration operations and workspace-separation tests, not ordinary run creation. Those tests manufacture the old state by removing the now-required field. Current schema compatibility and technical-data isolation are separate from maintaining that migration fixture.

The dated local audit found all 244 rows populated, but this could not be refreshed. These endpoints cannot migrate production under their current guard. Their deletion would not remove a currently usable production migration mechanism; the validator/type and quota rules would still be required.

## 7. Focused tests pass, but they do not prove a unified selection policy or deployment retirement safety

Two commands ran with `pnpm exec vitest run <files> --maxWorkers=2`. Exact file groups and results follow; paths are under `src/__tests__/convex/`.

| Executed group | Files | Observed result |
| --- | --- | --- |
| Selection and admission | `research-runs/{research-launch,framing,run-workspace-separation}.test.ts`; `execution/{workbench-continuity,retained-workbench-control,qualification-method-comparison,operation-conformance}.test.ts` | 7 files, 83 tests passed; 16.27 seconds |
| Retained effects and recovery | `execution/{one-shot,workbench-operation-effects,model-action}.test.ts`; `sources/sources-reopen.test.ts` | 4 files, 88 tests passed; 17.76 seconds |

Raw outputs: [selection/admission log](legacy-version-research-tests.log) and [retained-contract log](legacy-version-retained-contract-tests.log). These suites use real Convex modules/schema with the project test harness and component adapters; clocks and external provider boundaries are controlled. No paid provider or live deployed journey ran. Pi recovery, backend-specific tests and input-profile generation were inspected but not run. No project-wide application build, lint or typecheck was needed for this research-only artifact.

Reproduce the two groups from the repository root:

```sh
pnpm exec vitest run src/__tests__/convex/research-runs/{research-launch,framing,run-workspace-separation}.test.ts src/__tests__/convex/execution/{workbench-continuity,retained-workbench-control,qualification-method-comparison,operation-conformance}.test.ts --maxWorkers=2
pnpm exec vitest run src/__tests__/convex/execution/{one-shot,workbench-operation-effects,model-action}.test.ts src/__tests__/convex/sources/sources-reopen.test.ts --maxWorkers=2
```

`pnpm docs:check` passed: 76 Markdown files, 449 local links, zero errors; the existing `TECH.md` word-count warning remains advisory. That checker excludes this local artifact directory. A separate filesystem check verified this document's 44 links and cited line bounds before this validation paragraph was added. The document review kept dated evidence separate from current behavior and left normative references unchanged.

Test-version intent matters. [setup/workbench.ts:25](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/setup/workbench.ts:25) defaults its fixture to Workbench 5 after calling current confirmation; `null` preserves the actual admitted default. Thus a passing helper-based test does not automatically cover current Workbench 12. Explicit historical pins remain useful when testing their contracts. [model-action.test.ts:204](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/model-action.test.ts:204) derives the provider receipt version from the actual mission; that guards adoption without freezing a moving default. Operation-effect coverage exercises real writes, retained effects, acknowledgements and replay, including historical numeric results.

The inspected tests cover pieces of selection, but no single cross-entry matrix was found that establishes precedence across new conversation, first turn, request replay, child mission, qualification override and resumed mission together. A future refactor needs characterization at those consuming boundaries, especially missing pins and replay-before/after-resolution order. Deployment scheduling/Workflow inventories and history readers after definition removal remain separate verification gaps; deterministic tests cannot replace them.

## Architecture documentation and remaining decisions

[TECH.md:127](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/context/TECH.md:127) currently promises that legacy Workflow records and direct AI SDK/Convex Agent tasks stay runnable without implicit migration. [ROADMAP.md:18](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/docs/ROADMAP.md:18) repeats historical execution compatibility, while its source-review row describes retained readability. These are distinct guarantees. The research does not narrow either contract.

The prior Oracle sequence remains a proposal: remove obsolete launch/backfill surfaces first; retire old executors and corpus-review orchestration after an explicit compatibility decision and deployment inventory; retain real conversations and useful comparisons until their fate is decided. No generic migration framework is implied by the current code. Technical design can assess extending the existing catalog to own effective selection, while preserving distinct operation, skill and profile owners.

## Open questions and next phase

The unresolved factual question is deployment state: which conversations, operations, scheduled targets and Workflow instances still need each retained definition or executable function? The targeted follow-up status check could not answer it because the local backend was stopped. Readability also needs validation against whichever specific registrations the later design proposes removing; no removal set has been approved.

The next phase is technical design. It must settle the scope of the shared selection owner, the documented historical-execution guarantee, and whether any continuing conversation or comparison capability is to be retired. Keep these decisions distinct from implementing the already-researched code changes. Source references above cover the key callers and owners for all seven questions; they are not a claim that every historical record reader or deployed pending job was inspected.
