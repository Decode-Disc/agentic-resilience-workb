---
type: research-questions
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
flow: tdd
---

# Research Questions: Sources State, History and Completion

## Key Context Pointers

The [request](22-request-sources-harness-efficiency.md) owns the desired outcome and scope. The [retained diagnosis](/home/abdwhb/.cache/workbench-evaluations/framing-v9-qualification-20261120-ready/diagnosis-sources/diagnosis.md) supplies the causal evidence and reproduction script. Read the current implementation and [technical contract](../../../context/TECH.md) against that evidence; do not repeat the completed trace investigation or assume historical failures remain unchanged.

```text
Convex mission facts ──→ required model state
                    ├─→ dossier/action projection ──→ consultation
Retained observations ─→ history references/pages ──→ native Pi loop
Model completion ──────→ parsing/validation ─────────→ domain adoption
Documentary control ───→ provider stream ────────────→ receipt/settlement
```

## Questions

1. **Which diagnosed mechanisms remain in the current bindings?** What changed between the frozen Workbench 9/Sources 5 lot and the current registered versions, especially shared capture/read access, current-state rendering, response schemas, SSE handling and terminal receipt settlement? Which old observations still exercise the same owners, and which require a new deterministic reproduction? Start with `convex/execution/agentCatalog.ts`, `convex/domain/sourcesAgent.ts`, `convex/domain/workbenchAgent.ts`, `context/TECH.md`, `docs/ROADMAP.md`, the frozen `lots/lot-1/code/`, and documentary-engine documents 15–21. Report delivered changes separately from remaining defects and unverified semantic quality.

2. **What does each state projection mean to each caller?** During collection, qualification, pause, renewal, settlement and completion, how do required `activeWork`, `consult_run_state`, available operations and analyst actions derive from authoritative records? When do `retainedDocuments` and `nextCapability` become populated, and which conditions produce `human_prerequisite_required`? How do reuse identities refresh these projections? Trace Sources, Workbench and presentation consumers through `convex/domain/researchState.ts`, `researchStateContracts.ts`, `sources.ts`, `sourcesAgent.ts`, `convex/execution/commonOperations.ts`, `approvalCatalog.ts`, `researchControl.ts` and `missionData.ts`. Distinguish a genuinely blocked mission from a currently inapplicable analyst action without inferring authority from labels.

3. **How does native history recovery select and deliver the needed observation?** What current information is supplied automatically, what does `consult_mission_state` promise and return, and how do direct references, first-page reads, immutable frontiers and continuation cursors interact? What purpose and constraints own the 4,000-character fragments, 48 KiB response envelope and underlying storage fragments? Where does each page require another model generation, and which tests cover response utilization rather than only exact restoration or database reads? Start with `convex/execution/history.ts`, `missionHistory.ts`, `journal.ts`, `commonOperations.ts`, `convex/integrations/piMission.ts`, `convex/resourcePolicy.ts` and `src/__tests__/convex/execution/history-read-cost.test.ts`. Check existing Pi recovery capabilities before considering any application-owned replacement.

4. **How do native operations and final completion cross the execution contract today?** Which registered agents use free assistant text, structured completion proposals or text-completion adapters? Where are schemas rendered, responses parsed, feedback inserted, effects adopted and completion freshness/unfinished work checked? What completion or structured-tool capabilities exist in the installed Pi packages, and how do the current adapters use them? Trace `convex/execution/invokeAgentModel.ts`, `invocationLifecycle.ts`, `executionProtocol.ts`, agent definitions and `convex/integrations/piMission.ts`. Establish compatibility requirements for pinned historical conversations, correction after refusal, interruption/replay and tool side effects before the design chooses a mechanism.

5. **What remains established and unresolved about documentary-control degeneration after the transport corrections?** How do the actual strict schema, provider route, input hash, text deltas, terminal reason, usage, cancellation and settlement correlate for the three failures and successful controls, including the same-input retry? What diagnostics survive a disconnect now, and which sibling transports preserve the current streaming resource policy? Start with the retained Arize correlations, `convex/integrations/documentaryControl.ts`, `modelTransport.ts`, `scripts/evaluations/workbench-browser/relay.mjs` and existing transport tests. Separate already corrected client cutoffs from provider behavior. Use retained/offline evidence; identify any indispensable live experiment and its unresolved question without executing paid calls under this request.

6. **Which existing integration boundaries can falsify the required invariants?** What coverage already protects state/action distinctions, current versus finalized documentary material, history membership and pagination, native completion/adoption, cancellation, real human prerequisites and cumulative accounting across registered consumers? Inspect `src/__tests__/convex/execution/{research-state,mission-history,conversation-history,pi-mission,pi-native-transport,operation-conformance}.test.ts`, `src/__tests__/convex/sources/{sources-completion,sources-completion-freshness,sources-completion-correction,documentary-control-integration}.test.ts`, and the transport suites. Identify missing representative guards and independently derived UTF-8/UTF-16 or page-capacity boundaries. Specify which retained-data measurements can quantify call/response amplification before and after a correction, and which judgments still require separate semantic qualification. Do not encode all 61 historical inspection generations as wasted or promise a target call reduction without measurement.

## Research Deliverable

For each question, record verified behavior, owner and consumers, evidence, existing tests, and unresolved facts. Keep alternatives and implementation choices for the subsequent technical design. The expected result is a bounded correction scope reconciled with current code, not a repetition of the earlier qualification or a new documentary architecture.
