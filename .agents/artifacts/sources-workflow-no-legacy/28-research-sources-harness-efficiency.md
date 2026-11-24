---
date: "2026-11-21T21:17:29+01:00"
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
topic: "Sources state, history, completion and documentary-control evidence"
type: research
flow: tdd
tags: [research, sources, execution, history, completion]
status: complete
---

# Research: Sources Harness Efficiency

## Scope and evidence

This document answers all six questions in [the research scope](23-research-questions-sources-harness-efficiency.md): current bindings, state semantics, history recovery, native completion, documentary-control failures and falsifiable integration boundaries. It describes the system at the recorded commit; technical choices belong to the next TDD. The original [request](22-request-sources-harness-efficiency.md) remains the scope owner. Documents 24–27 belong to a separate generation-resilience workstream and are not replaced by this research.

Evidence combines current code, the frozen Workbench 9/Sources 5 captures, the later November 21 qualification report, and new offline checks. The [original causal diagnosis](/home/abdwhb/.cache/workbench-evaluations/framing-v9-qualification-20261120-ready/diagnosis-sources/diagnosis.md) supplies historical model behavior, not current semantic acceptance. Reexecuting its assertions, with output redirected to this task's validation directory, reconfirmed all 136 admitted `activeWork` snapshots, 61 inspection-only generations, 19 calls in two history traversals and three whitespace failures. No archived evidence was overwritten. New checks used real internal owners and mocked external HTTP where required; no application-provider inference, backend publication or dependency change occurred.

One read-only analyzer, Claude Sonnet 5.5 at high effort, traced native completion and installed Pi capabilities. Its [completed report](validation/sources-efficiency-research/completion-analysis.md) retains exact owner references, tested suites and unverified boundaries. The parent checked the decisive decoder, adoption and native termination mechanisms before synthesis. No implementation or review was delegated.

## The remaining contract defects survived documentary unification

Current defaults are Workbench 12, Sources 7 and inspection 3. Sources 7 inherits Sources 5's state and completion owners, replaces `make_source_consultable` with shared `acquire_document`, and gains issued capture/read references. Workbench 10–12 and Sources 7 now share capture acquisition, lexical search and contextual reading. Historical definitions remain registered. See [agentCatalog.ts:142](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:142), [sourcesAgent.ts:623](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:623) and [TECH: shared documentary operations](../../../context/TECH.md#shared-documentary-operations).

| Historical mechanism | Current evidence | Interpretation |
| --- | --- | --- |
| Dossier actions and final document membership exposed beside active Sources work | `researchState`, `approvalCatalog`, `commonOperations` and `missionHistory` are byte-identical to the frozen lot; a new registered Sources 7 probe reproduces the conflicting impression. | Still present; not explained by obsolete capture tools. |
| History fragments stop at 4,000 UTF-16 code units | The only `history.ts` change narrows reference handling to the correct operation; the page algorithm is unchanged. The current integration measurement again needs twelve pages for its long event. | Still present. |
| Sources completion parses whole assistant text as JSON | `invokeAgentModel.ts` is byte-identical; Sources 7 inherits the same completion contract. | The structural failure path remains; no new live recurrence is claimed. |
| Cumulative 1 MiB SSE cancellation | Current shared transport and evaluation relay apply the byte limit only to non-SSE bodies; both pass oversized-SSE tests. | Already corrected; not work to repeat. |
| Known one-shot result lost before auxiliary billing acknowledgement | `finishOneShot` now retains terminal result/receipt and schedules billing atomically. The focused lost-acknowledgement regression passes. | Already corrected; distinct from upstream incomplete generation. |

The [owner comparison](validation/sources-efficiency-research/owner-comparison.json) records file equality against the frozen lot. The [roadmap](../../../docs/ROADMAP.md#current-delivery-state) separates these delivered mechanisms from unaccepted live task quality. Earlier documentary-engine research describes its historical baseline, not today's pre-Start capture capabilities.

## Required state and dossier consultation describe different stages

```text
Preparation records + adopted operations
  └─ Sources definition.context
       └─ activeWork: needs, work, captures, readings, contributions, allowance
            └─ required native state on each generation

Run + final preparation result + approval readiness
  └─ readResearchState
       ├─ consult_run_state
       ├─ Workbench context / response control
       └─ workspace summary and action controls
```

Sources context contains current needs/revision, work requests and outcomes, capture IDs, current documentary inventory, qualification and reading references, complete controlled contribution statements/restrictions, remaining allowance and candidates. Sources 7 adds shared capture metadata and acquisition references and reads all candidates rather than the retained definition's 61-row window. This state is built from preparation and adopted operation records, not from the final handoff. See [sourcesAgent.ts:345](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:345) and [sources.ts:903](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sources.ts:903).

In contrast, `readResearchState.sources.retainedDocuments` comes exclusively from `preparation.sourcesMission.result.documents`. Empty therefore means no final retained membership, not no acquired, read or controlled material. `nextCapability` is null until that result exists, then reports `investigation_unavailable`. Existing workspace/Workbench material projections already distinguish capture availability, qualification and retained membership; the compact dossier projection does not incorporate those ongoing facts. This is a semantic mismatch between surfaces, not evidence that their authoritative records are missing. See [researchState.ts:70](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/researchState.ts:70), [sources.ts:765](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sources.ts:765), [workbenchContext.ts:94](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchContext.ts:94) and [research-state.test.ts:604](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/research-state.test.ts:604).

Action applicability is not dispatch authority. `continue_sources_preparation` returns `human_prerequisite_required` whenever readiness is not `renew_window`, before returning readiness's more specific block. Resume reports that same code when the run is not in a resumable pause. These branches include an ordinary running preparation. Conversely, a true human-review pause, capacity/slot refusal, disabled paid work or nonrecoverable interruption must retain their actual authority effects. See [approvalCatalog.ts:37](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/approvalCatalog.ts:37), [researchControl.ts:552](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/researchControl.ts:552) and [transitions.ts:11](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/transitions.ts:11).

| Actual state | Existing projection / transition |
| --- | --- |
| Running collection or qualification | Pause applicable; Resume and Continue inapplicable, possibly with `human_prerequisite_required`; no final retained documents yet. |
| Analyst pause | Resume can execute or cancel a pending pause; execution slot and generation are rechecked. |
| Time-limit decision | `renew_window` checks slot, configuration, paid-work switch and remaining Sources capacity; ordinary Resume points to the dedicated decision. |
| Settlement requested | Further continuation is refused as `sources_settlement_requested`; engaged work must settle before handoff. |
| Completed/partial/no-material handoff | Final membership and outcome appear; preparation phase preserves that result through later analytical states. |
| Blocked/cancelled mission | `executionStop` comes from the actual mission block or retained stop, not an unavailable action label or model explanation. |

The new [Sources 7 probe](validation/sources-efficiency-research/state-probe.json) confirms a running, collecting preparation with a current capture, no pending approvals, no execution stop, empty final membership and both misleading action reasons. It also changes current candidate metadata: `activeWork` changes while the compact dossier projection and its request ID remain unchanged. This is expected reuse under that projection. The pin hashes lifecycle/status/generation plus `readResearchState`; `operationReuseIdentity` includes the pin and objective/scope/input/version. No stale-cache corruption was reproduced. See [commonOperations.ts:83](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/commonOperations.ts:83) and [missionData.ts:142](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionData.ts:142).

## History is recoverable, but its page construction creates extra model turns

The common tool describes reading current required state and historical observations. Under Pi Durable, `readMissionState` instead returns mission metadata and a hash/pointer to the automatically supplied `workbench_current_state` section; historical reads bypass Sources' consultation truncation adapter. Sources instructions already say that current facts live in `activeWork`, but the shared tool description still promises current state. These are different contracts presented together. See [commonOperations.ts:25](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/commonOperations.ts:25), [missionHistory.ts:38](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionHistory.ts:38), [sourcesAgent.ts:150](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:150) and [modelInput.ts:112](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelInput.ts:112).

An unreferenced first read starts at sequence 1 under a frozen frontier. An explicit event reference selects that event after mission/run membership checks; current context observations have a controlled cross-mission exception within the same run. Continuations are opaque `history:<requestId>` handles: the prior read must be completed, successful and adopted, with matching source, mission, run, generation and instruction version. The receipt retains the original frontier and exact next offset. Consultation-only activity does not advance the material frontier. Fabricated or foreign cursors are refused, while corrupt retained receipts raise an incident. See [history.ts:82](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/history.ts:82), [history.ts:182](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/history.ts:182) and [journal.ts:674](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/journal.ts:674).

| Boundary | Unit and current owner | Behavior |
| --- | --- | --- |
| Mission event fragment | Literal 4,000 UTF-16 code units, `history.ts:484` | Page stops when that event remains incomplete, even with free response space. No independent storage requirement for this value was found. |
| Conversation fragment | 8,192 UTF-16 code units, `history.ts:324` | Separate message-reading path; preserves surrogate pairs. |
| History response | 48 × 1,024 serialized UTF-8 bytes, `resourcePolicy.ts:157` | Includes metadata, JSON escaping, state pointer and cursor. Oversized first fragment returns capacity refusal. |
| Mission page | At most 20 source events/fragments, `resourcePolicy.ts:149` | Also checked in receipt validation. |
| Retained-text storage | 60 × 1,024 UTF-16 code units per storage fragment, `resourcePolicy.ts:314` | Separate Convex storage concern; historical invocation reads load intersecting fragments. |

The current [measurement](validation/sources-efficiency-research/history-measurement.json) restores a 44,418-character event in twelve consultations, with 4,765–5,299-byte responses and 572,299 logical inline payload bytes delivered to the query. This is an existing synthetic integration fixture, not production database traffic or provider latency. Historical captured traversal chains independently show the same mechanism on real outputs, including a final nine-character page. Once a model chooses to follow a continuation, the application returns one page per operation and the native loop generates again to request the next; it does not autonomously drain the whole event.

There is also a compatibility constraint: inline `historyTextFragment` validates an offset by walking canonical boundaries using the supplied fragment width. Receipts store offsets and fragment identities, not the original width. Changing that width alone can invalidate an already-issued inline continuation. The current tests preserve completed old receipts, source/instruction membership and exact Unicode restoration, but do not qualify a changed pagination policy. See [journal.ts:288](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/journal.ts:288), [journal.ts:363](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/journal.ts:363) and [conversation-history.test.ts:477](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/conversation-history.test.ts:477).

Pi already owns persistent transcript replay and native compaction; the application registers required current state separately, supplies immutable observations through native writes, and checks admitted observation/tool/state proofs before dispatch. History consultation is an evidence-retrieval operation, not a missing replacement conversation-memory system. See [piNativeInput.ts:30](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piNativeInput.ts:30), [piMission.ts:599](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:599) and [piMission.ts:1384](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:1384).

## Native tool schemas do not currently enforce Sources completion format

```text
Pi generation
  ├─ tool calls → operations → pin / authorize / persist → execute → adopt
  └─ assistant answer
       ├─ Workbench: textCompletion(text) → typed completion
       └─ Sources / inspection / validation: JSON.parse(entire text)
            → general response validation
            → pinned definition completion validation
            → pending-work / freshness / domain checks
            → correct, refresh, block or complete
```

Workbench versions 4–12 inherit the text-completion adapter. Sources versions 4–7, inspection 2/3 and the two validation definitions have no such adapter. `constraints.completion` places either a text marker or the definition's JSON schema in required model state. Operations are actual native tools; the terminal completion is not a tool, and the native request does not send a response-format schema. The model configuration nevertheless requires structured-output capability for non-Workbench agents. Thus admission capability and the completion mechanism actually exercised are distinct. See [context.ts:314](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/context.ts:314), [invokeAgentModel.ts:72](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invokeAgentModel.ts:72), [workbenchAgent.ts:428](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchAgent.ts:428) and [modelConfiguration.ts:71](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/modelConfiguration.ts:71).

If a response includes operations, its prose does not complete the mission. Without operations or a text adapter, prose around JSON fails whole-text parsing. A received parse/union failure has a specific correction path: the original output and failed receipt are retained, `correctCompletion` returns the mission to ready, and Pi receives correction feedback plus fresh state before generating again. By contrast, an `invalid_output` caused by `finish_reason_invalid` such as `length` takes a terminal mission-block path. The same displayed failure family therefore does not imply the same recovery behavior. See [invocationLifecycle.ts:1272](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:1272), [piMission.ts:1286](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:1286) and [pi-native-transport.test.ts:257](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/pi-native-transport.test.ts:257).

Sources completion is more than JSON acceptance. The domain derives `needsRevision` and mandatory work accounting from the immutable admitted snapshot, adds the model's cited reading IDs, checks every need and known obligation, and rechecks current work and instructions. Newly engaged work produces a refresh/wait rather than silently adopting an obsolete proposal. Unfinished work and unsupported gaps receive domain feedback. Completed requests retain their operation identity and effects; repeated finalization returns the recorded outcome. A cancelled/stale generation can retain a late response and cost without adopting its result. These fences are compatibility requirements for any subsequent interface choice. See [sourcesAgent.ts:469](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:469), [sources.ts:1299](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sources.ts:1299), [invocationLifecycle.ts:1111](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:1111) and [authority.ts:42](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:42).

The installed Pi AI, Pi Durable and Chord packages are 1.4.0; Pi Coding Agent is 1.5.0. Local source establishes these available mechanisms, without a dependency upgrade or vendor compatibility recommendation:

| Installed native mechanism | Actual behavior and application usage |
| --- | --- |
| Tool result `control.terminate` | Pi runs `afterTools`, then ends without another generation only when every call in the round completed through a task whose result requests termination. The application does not use this control. It is a native mechanism to evaluate in TDD, not a delivered completion integration. |
| `constrainedSampling` on tools | Pi AI supports JSON-schema strict preference/requirement. Its OpenAI adapter enables strict sampling when opted in and supported; the application's current `piToolMetadata` does not opt in. Provider enforcement remains separately unverified. |
| `structuredOutputSchema` / `structuredOutput` | Validated programmatic tool-result channel; not a model's terminal completion format. |
| `onYield` and `afterTools` | Already used for application-controlled continuation, settled observations and refreshed tools. |
| Native request `toolChoice` | Current app adapter accepts `auto` or `none`; no forced named-completion-tool path is integrated. |

Primary installed sources: [ToolControl](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:92), [finishToolRound](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@earendil-works/pi-durable/dist/harness/generation.js:528), [constrained tool sampling](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@earendil-works/pi-ai/dist/types.d.ts:520) and [OpenAI serialization](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1158). The absence of a general completion-schema option in the inspected Pi types is not proof that all alternative integrations are impossible. Mixed tool rounds, refusal recovery and terminal adoption would need their own consuming-boundary checks before choosing a tool-based completion.

There is one reference discrepancy to resolve in TDD: [TECH's completion passage](../../../context/TECH.md#completion-and-publication) says validation failures trigger “one bounded continuation correction”, while [Loop Prevention](../../../context/TECH.md#loop-prevention) and the current implementation allow repeated rejected completions within remaining execution authority. Native tests explicitly complete after five format refusals. `native_preparation_stalled` guards unchanged request preparation, not this completion count. This research records the conflict without silently imposing a new limit or editing the owning reference.

## Documentary generation remains intermittent after local transport corrections

The documentary controller constructs a strict findings object keyed by the exact submitted contribution IDs, limits permitted uses by contribution kind, requires a boolean `coherence` and preserves limitations. It validates and normalizes the response before adoption. The original lot had seven successful and three incomplete controls under that schema. Each incomplete output stopped at `"coherence":` followed by whitespace; two ended through the obsolete SSE cap, one through provider `length`. Retained Arize correlations independently match the first two incomplete prefixes on Wafer. Success with the same input/schema excludes deterministic schema rejection; it does not identify the upstream failure. See [documentaryControl.ts:13](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/documentaryControl.ts:13) and the original diagnosis.

The [later qualification and follow-up](../../../docs/verification/2026-11-21-framing-fidelity-live-qualification.md#follow-up-diagnosis--2026-11-21) adds stronger retained evidence: the same unfinished-boolean pattern after the SSE fix; an identical wire request succeeding on retry; and a timeout after the actual action-generation boundary, not after a cumulative byte ceiling. Its offline replay regenerated the wire request and preserved the exact incomplete stream. These checks were performed in that investigation, not repeated here.

The report's already-authorized two-call experiment also completed with both the unchanged schema and the boolean-first variant on the same endpoint used by a failed control. Thus schema order is not a demonstrated repair, and another identical two-call proposal would repeat work. The variant introduced a semantic inconsistency between a structured permission and its free-text restriction; its output was not adopted into a dossier. Upstream decoder internals, sampling and serving state remain unresolved. No provider pin, schema reorder, smaller output allowance or additional paid experiment is established by this research.

Current transport classifies the HTTP content type and applies `MODEL_NON_STREAMING_RESPONSE_MAX_BYTES` only to buffered/non-SSE content. The same shared fetch owner serves native and structured calls; the qualification relay independently uses the same streaming exception. The inspected sibling paths retain deadlines, cancellation and cumulative admission. Visible text is retained in fragments with a completeness marker; available generation IDs, usage, terminal reason and cost survive failure when observed, while missing final billing remains explicit. `finishOneShot` now stores returned failure and schedules eligible billing in the same mutation, avoiding the earlier result-before-billing ordering loss. See [modelTransport.ts:330](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:330), [modelTransport.ts:1060](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:1060), [relay.mjs:575](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/relay.mjs:575), [preparationModel.ts:223](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:223) and [invocationLifecycle.ts:968](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:968).

## Existing tests protect integrity more fully than presentation and efficiency

| Owning boundary and tests | Coverage inspected | Remaining representative proof |
| --- | --- | --- |
| `research-state.test.ts`, actual definition context and `consult_run_state` | Current stops, stale/foreign authority, changed pins, historical receipts, captured versus retained membership, qualification identity, settled partial outcomes. | Running agent state must distinguish unavailable analyst actions from mission blockage; current material versus final membership must remain explicit across consumers. New research probe reproduces today's behavior, not a desired fix. |
| `mission-history`, `conversation-history`, `history-read-cost` | Immutable observations, cursor membership/frontiers, corrupt receipts, Unicode restoration, bounded source-row reads. | Mission page utilization and preservation of issued continuations under a changed policy. The cost test explicitly asserts more than ten pages, so its current expectation freezes the diagnosed fragmentation. |
| `sources-completion-correction`, `sources-completion-freshness`, `sources-completion` | Structured correction, refusal retention, admitted revision/work accounting, late obligations and settlement. | Full serialized Sources 7 completion path after the next design choice, including malformed reply, correction, duplicate completion, cancellation and no replay of prior effects. Several existing fixtures deliberately pin Sources 5. |
| `documentary-control-integration`, `documentary-control-transport` | Real control/adoption with fake HTTP, scheduled waits, stale generation, cancellation, exact evidence, effective permissions, incomplete output diagnostics, native continuation, large SSE. | Intermittent upstream termination and semantic agreement of permission with rationale cannot be established by synthetic HTTP responses. |
| `source-qualification-action`, `one-shot`, relay suite | Terminal receipt, lost acknowledgement, billing scheduling, cumulative allowances and streaming/non-streaming distinction. | No new defect established here; retain these protections across future completion changes. |

For pagination, independently derived boundary cases must separate UTF-16 offsets, UTF-8 bytes and JSON-escaped size: a non-BMP character occupies two UTF-16 units/four UTF-8 bytes; control-character escaping can occupy six ASCII bytes per original unit. An exact fit and one-unit overflow must include envelope/cursor overhead. Existing conversation tests place an emoji across the 8,192-unit boundary; no equivalent mission-page fill/overflow regression was found in the inspected history suites. This identifies missing evidence, not a selected page-sizing algorithm.

Before/after measurements can reuse the immutable real traversal payloads and existing `readHistoryPage` integration boundary: restored content hash and membership, consultations per selected event, serialized response bytes, and logical storage reads. The existing synthetic long-event fixture supplies a stable regression baseline but must not be mislabeled real production measurement. Published savings require an actual replay after a correction. All 61 inspection-only generations cannot be counted as waste, and fewer history pages cannot prove better documentary judgment.

## Checks executed and limits

All validation output is retained in [validation/sources-efficiency-research](validation/sources-efficiency-research/). The temporary state probe source was moved there after execution; no production or permanent test file was changed.

| Command or check | Observed result |
| --- | --- |
| Existing capture assertion script, executed with its output path redirected | 136 state matches; 61 inspection-only generations; 19 traversal calls; three whitespace failures. |
| `pnpm exec vitest run` for history cost, mission history, conversation history, research state and documentary-control transport | 66 tests passed in five files. |
| Same runner for Sources completion correction/freshness, documentary-control integration and retained one-shot execution | 44 tests passed in four files. |
| Temporary Sources 7 state probe through real context and registered operation | One test passed. Initial fixture omitted fixed framing and failed with `fixed_framing_unavailable`; corrected fixture established the actual result. That setup failure is not an application finding. |
| Source qualification action selected by `-t 'lost billing-scheduling acknowledgement'` | One regression passed; 32 unrelated cases excluded by the selector, not asserted as checked. |
| `node --test src/__tests__/config/workbench-relay.test.mjs` | 26 tests passed, including oversized SSE and bounded non-streaming response. |
| Analyzer's three focused Vitest selections, listed in its completed report | 64, 90 and 87 tests passed. Coverage includes native correction, pinned definitions, operation conformance, replay and cancellation. Some suites overlap the parent's checks; these are not summed into a unique-test total. |
| `pnpm docs:check` and local research-link check | 74 tracked Markdown files / 445 links / zero errors; existing advisory TECH length warning. Research links checked separately because the task directory is ignored. |

No production fix, browser test, live model experiment or full-project validation was performed. Current deployment state and general semantic usefulness remain outside this offline research. The main unknowns are upstream structured-generation nontermination and the effect of future interface corrections on model choices. Those unknowns do not prevent designing the demonstrated state, history and completion contract corrections.
