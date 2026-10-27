# Agentic Execution: Retained Conception

## Status and Ownership

Accepted on 2026-10-26 after examining Sources experiments, comparing execution alternatives, and extending the selected contract to Sources, Investigation, and Synthesis. Refined and explicitly accepted on 2026-10-27 through repository discovery, an independent architectural review and staged decisions on ownership, continuation, context continuity, loop prevention and traceability. This document retains the conception and its rationale; the [technical contract](../../../context/TECH.md#agentic-missions-and-shared-operations) owns current execution obligations. The [global conception](2026-10-23-question-led-workbench-conception.md) records workflow order, cooperation, inventory rules, analyst judgment, and functional outcomes. Implementation integration and semantic quality remain unverified.

The destination is an agent that can adapt its work through controlled business operations, preserve useful progress, and recover without making the analyst coordinate routine execution. This conception records execution choices without introducing another agent framework or claiming that model reasoning is deterministic.

## Shared Harness Decision of 2026-10-27

The accepted path is one mission and continuation protocol executed by the existing Convex Workflow engine. Its destination is reusable execution that lets system code act directly, assign authorized work to an agent, suspend between operations, perform business processing and resume without copying execution guarantees into each mission. A durable mission retains its identity and work while individual model invocations remain temporary. A bounded one-shot task shares invocation and tracing guarantees without requiring conversational continuation.

The accepted code boundaries are a common `convex/execution/` owner for execution guarantees, static versioned agent definitions, and business operations remaining in their existing domains. Creating an agent supplies instructions, context construction, allowed operations and result criteria to the shared executor. Creating an operation supplies its authoritative domain contract once; native calls and tool bindings share it. The [technical structure and handoff contract](../../../context/TECH.md#shared-execution-structure) specifies these responsibilities without requiring a file per concept or a new plugin framework.

| Compared structure | Decision and reason |
| --- | --- |
| Separate orchestration in each mission, with shared helpers | Not selected for the common agent lifecycle: repetition of suspension, retries and accounting would leave several maintenance paths. Domain workflows still retain their own phase transitions. |
| Common mission/continuation protocol on Convex Workflow | Accepted by the user after independent review. It centralizes execution guarantees while preserving domain-owned semantics and artifacts. |
| Independent mission workflows with persistent mailboxes | Not selected for the current ordered dependencies and bounded returns. Reconsider only if independently progressing missions create a demonstrated need for message delivery and acknowledgement. |
| Agent-proposed bounded plans executed by the system | Not selected as the general architecture because readings and control results can change the inquiry. Finite independent operation batches remain compatible with the selected protocol. |

The user selected suspension at operation boundaries rather than transport preemption for ordinary handoffs. Requests and outcomes are retained before continuation; multiple requested mutations require sequencing and version revalidation. Context continuity was explicitly reinforced: necessary context is supplied automatically, working memory is retained, earlier observable detail remains retrievable, and required context is never silently discarded when capacity is insufficient. These choices refine the sections below; concrete obligations belong to the [context contract](../../../context/TECH.md#context-recovery-and-resource-accounting).

The accepted loop policy combines result reuse, deterministic non-progress detection, business bounds on mission returns and cumulative dossier resources that survive restarts. Traceability links native and agent actions through their causes to attempts, controls and artifacts. Factual provider receipts remain distinct from authority to adopt a late result. Numerical thresholds, detailed storage and semantic usefulness remain implementation/evaluation work rather than claims made by this decision.

## Shared Mission Contract

The system starts an authorized mission with its scope, applicable versions, allowed operations, resource constraints, expected artifacts, and progression conditions. The specialized agent chooses useful inspections, hypotheses, confrontations, and proposals within that frame. The system continues to conduct the global workflow.

```text
Mission and required continuation context
                 |
                 v
Agent invocation chooses useful work <-------------+
                 |                                |
                 v                                |
Operation request retained                        |
                 |                                |
                 v                                |
Shared business operation                         |
Targeted change and required controls              |
                 |                                |
                 v                                |
Result or interrupted state retained               |
                 |                                |
                 +-- Further work ----------------+
                 |                                |
                 +-- Authorized recovery ----------+
                 |
                 v
Completion proposal or explicit incomplete outcome
                 |
                 v
System checks progression and human prerequisites
```

A model ending its turn or declaring success does not establish mission completion. The [completion and review contract](2026-10-23-question-led-workbench-conception.md#mission-completion-contract) governs usable results, justified insufficiency, pending judgment, and incomplete execution.

## Compact Context and Information on Demand

| Information | Access |
| --- | --- |
| Mission, scope, questions, human instructions/decisions, constraints, current versions, active obligations and returned operation result | Supplied directly at launch or continuation, with changes identified. |
| Available documents, existing contributions, examined avenues, open hypotheses and rejected interpretations with reasons | Retained orientation and working memory, distinct from established facts; details remain retrievable. |
| Passages, surrounding context, qualifications, restrictions, and comparisons | Retrieved by the agent for the current need, with explicit reading limits. |
| Captures, inspected references, artifact revisions, operation results, and history | Retained independently of the current model context. |

The agent controls what it needs to inspect; the system supplies scoped retrieval and reproducible references. A search result is a lead, not established support. Removing text from the working context neither deletes its recorded inspection nor grants authority to unseen material. Citation use still depends on access, version, provenance, and permitted use.

Results returned on demand do not accumulate indefinitely in each subsequent request. The 2026-10-27 refinement selected automatic preservation, independent of a save-memory action, with required context, working memory and retrievable observable history. A summary or work note cannot replace exact evidence. Required context that cannot fit produces an explicit block rather than silent omission. Detailed schemas, reading windows and history storage remain implementation choices under the technical contract; no cross-dossier learning or institutional memory is introduced. Preservation makes information available without proving correct use by a model.

## Complete Operations and Targeted Changes

Use the [shared business-operation model](2026-10-23-question-led-workbench-conception.md#shared-business-operations-and-agent-tools): native system calls and agent bindings reach the same domain implementation and controls. Shared implementation does not grant every mission access to every operation.

The agent proposes meaningful changes with evidence and justification rather than reserializing an entire artifact to alter one contribution. The domain operation preserves unaffected content, reconstructs and controls the resulting artifact, records its revision, and handles known dependent checks. This is a business contract, not an arbitrary JSON patch interface.

The agent can identify additional useful investigations. Once a verification is required by an applicable rule or a revision's known dependencies, the system organizes its execution within the authorized envelope. The caller receives a controlled result or precise feedback instead of coordinating internal verification steps. Unfinished checks remain visible and cannot silently replace a previously usable result with an apparently verified revision.

An operation can contain bounded model-assisted work. Logical completeness does not make external calls one database transaction: confirmed intermediate results and pending obligations must survive an interruption. Diagnostics retain the actual failed field, reference, version, or execution boundary rather than hiding a syntax failure behind a generic invalid-object message.

## Targeted Semantic Controls

Structural controls at domain boundaries remain mandatory. They establish properties such as valid references and versions, not that a passage supports the proposed interpretation.

A semantic control belongs to the submission operation for the object being proposed: documentary qualification, inventory contribution and uses, appraisals, or synthesis. The submission is a known execution event; the system does not first need to recognize a semantic risk to decide whether that control applies. The shared inventory rules and mission conceptions define what their respective controls examine. Consultation, search, reading, and handoff authorization retain their deterministic boundary checks without adding a semantic verifier to every action.

Sources also exposes a [targeted documentary check](2026-10-24-source-ingestion-and-processing-conception.md#documentary-controls), sharing the verification capability and documentary policy used by qualification. The system executes the verifier as a targeted model call, not a permanent parallel research agent. Its result informs domain policy rather than granting approval authority. When evidence is insufficient, the operation returns a precise diagnostic to the mission agent; the verifier does not silently rewrite the proposal through an internal correction loop.

A control records its examined object and scope, evidence references, conclusion, and limitations. An unfinished execution is distinct from an analytical conclusion of insufficient support. A partially examined argument cannot become fully supported because another part is plausible. Adverse results follow the [targeted re-examination and judgment rules](2026-10-23-question-led-workbench-conception.md#retained-judgments-and-pending-revisions). Self-review, verifier output, and schema acceptance remain fallible; none guarantees universal truth.

### Reuse of Controlled Results

Reuse an existing control when the same explicitly referenced object and use are taken unchanged, its evidence versions and applicable rules remain valid, and current restrictions still permit that use. The system revalidates authority, references, and applicable restrictions. Reusing a documentary result does not establish a new analytical inference, and a retained appraisal does not establish a new synthesis relationship.

The agent can reuse a controlled reference or submit a changed assertion or new use. The system need not ask another model whether differently worded proposals are equivalent. A new use of an existing assertion receives its own use control; a modified assertion receives its own examination. Required controls of a new submission, including resulting-artifact coherence, still apply while valid prior results can be reused. An unrelated dossier change does not by itself require every earlier control to be repeated.

## Preserved Work, Recovery, and Resources

Preserve the result and state after each operation, including incomplete obligations when an operation is interrupted. A continuation starts from that state with compact useful context; it does not depend on replaying the complete agent conversation.

Continue automatically after a recoverable technical interruption while the mandate, execution authority, applicable versions, and remaining allowances remain valid. Reuse confirmed completed work. An unknown provider outcome does not authorize blind repetition; isolate the affected work and continue independent work when permitted. Cancellation, expiry, or a changed execution generation cannot be bypassed by recovery or a late result. Otherwise, expose the stop and the work still outstanding.

Resource protection is cumulative at the dossier level under the applicable operation policies. Count actual provider calls, including agent reasoning, model-assisted business work, and semantic controls. A tool invocation is not a reliable substitute for that accounting. Continuation does not reset consumption or create another allowance.

The selected architecture does not add an arbitrary call quota for each agent or reserve a fraction of calls for a finalization phase. Normal completion follows the expected artifacts and controls. Hard resource and time limits still protect execution; they can leave work incomplete. Numerical values, reading-window sizes, concurrency, and operation-specific parameters are deferred to implementation against the then-current conditions; exploratory values are not retained configuration requirements.

Recovery cannot cross a human checkpoint or imply fresh adoption of a revised judgment. Those boundaries remain governed by the global conception rather than by the shared execution mechanism.

## Application to the Three Missions

| Mission | Agent's working focus | Mutation and control boundary |
| --- | --- | --- |
| [Sources](2026-10-24-source-ingestion-and-processing-conception.md) | Examine the available captured corpus, choosing readings and documentary confrontations within system-organized preparation. | Propose qualified documentary contributions and restrictions; preserve independent useful material and report gaps. Sources does not produce the shared analytical inventory's assertions. |
| [Investigation](2026-10-24-investigation-conception.md) | Use shared material and inventory to test interpretations across the framed questions. | Contribute controlled assertions and question-specific uses, then propose appraisals. Changes cannot silently rewrite a retained human judgment. |
| [Synthesis](2026-10-25-synthesis-conception.md) | Connect retained appraisals into an overall economic interpretation. | Preserve the joint coherence of diagram and argued note; route a necessary new premise through Investigation under the global cooperation rules. |

The shared mechanism does not merge their semantic criteria. Sources supplies qualified material; Investigation prepares the appraisals for grouped review; Synthesis uses retained judgments under the existing delivery rules. Targeted work can be incremental, while a supported synthesis still delivers its diagram and note together. The alternative non-establishment finding remains governed by the [synthesis outcome rules](2026-10-23-question-led-workbench-conception.md#synthesis-outcomes).

## Evidence and Architectural Lessons

### Harness Discovery and Independent Review

Discovery on 2026-10-27 inspected the five question-led conceptions, product and technical references, roadmap, existing Workflow execution, generation/slot claims, preparation authority, provider receipts, schema-derived validation and the experimental Sources runner. The installed packages examined were AI SDK `7.0.138` and Convex Workflow `0.4.10`. These observations establish available mechanisms and gaps, not integrated mission readiness.

| Primary evidence | Observed consequence for the design |
| --- | --- |
| `convex/workflow.ts` and `convex/sourcePreparationWorkflow.ts` | The common manager enables automatic action retries; preparation explicitly disables them on sensitive actions. A common invocation must preserve one attempt authority. |
| `convex/domain/executionClaim.ts`, `convex/domain/runCancellation.ts` and installed Workflow cancellation behavior | Slot claims and generation fences already exist; cancellation leaves dispatched actions able to finish. Ordinary handoff therefore has a separate continuation meaning. |
| `convex/providerCalls.ts` and `convex/domain/sourcePreparationAuthority.ts` | Existing preparation accounting retains unknown consumption and refuses blind replay. Receipt closure differs between preparation and legacy extraction; factual receipt recording and business adoption need distinct checks. |
| `convex/domain/sourceQualification.ts` and `convex/domain/sourceRetrievalPolicy.ts` | Authoritative schemas already derive Convex validators through `zodToConvex`; a new schema language is unnecessary. |
| Installed AI SDK tool-calling source and deterministic local probe | A tool without `execute` returns control; a recreated agent accepts a serialized continuation containing the system's tool result. Automatic tool execution uses concurrent dispatch, so it cannot supply the mutation sequencing guarantee. |
| `scripts/evaluations/source-selection/sources-approach-runner.ts` | Sources agent/tool experiments exist outside the production mission lifecycle and do not establish a common durable harness. |

One independently authorized architect reviewed the alternatives and these primary boundaries in read-only mode. Its final report recommended the accepted common protocol and challenged automatic retries, multiple-tool ordering, late receipt handling, cumulative repetition controls and identity across restarts. Review did not certify implementation or semantic quality.

The command `pnpm test src/__tests__/convex/workflows/durable-workflow.test.ts src/__tests__/convex/integrations/provider-calls.test.ts src/__tests__/convex/sources/source-preparation-budget.test.ts` passed 31 tests in the primary checkout, whose relevant implementation matched the target worktree at inspection. A separate in-memory probe imported the installed AI SDK and its mock model, returned one deferred tool call without executing it, serialized the continuation and supplied a system result to a new agent instance; it passed with no network calls. Neither check exercised a production durable agent handoff. No live backend or paid provider was invoked for this conception.

Session `01a17291-bc90-7833-9c34-1ffb9b9e6ab9` contains successive Sources experiments and architectural reviews. Their frozen results are linked from the [global research basis](2026-10-23-question-led-workbench-conception.md#research-basis-and-adaptation). The inspection comparison recorded a repeated useful Snowflake correction, a CrowdStrike regression, missed Adobe premises, and unfinished agent work. These are Sources findings, not an evaluation of the future Investigation or Synthesis missions. Later changes to the bench do not retroactively change the frozen outcomes.

### Source-to-Architecture Mapping

| Source component | Mechanism and lesson | Retained adaptation or divergence |
| --- | --- | --- |
| Initial Sources tool-definition overhead | Passage-dependent schemas consumed most of an initial request before useful reading. | Compact interfaces with runtime reference checks; no corpus-sized enumerations. Adapted from observed failure. |
| Cumulative Sources reading context | Evidence retention was coupled to a request-size ceiling, eventually blocking a previously possible reading. | Retain evidence separately from bounded working context and retrieve it on demand. Adapted from reproduced failure. |
| Whole-qualification rewriting and lost contributions | A local repair required repeating unrelated content and could degrade it. | Targeted changes with preservation and control of the resulting artifact. Adapted from observed failure. |
| Agent missions ending with pending comparisons | The agent had to remember to coordinate required follow-up work. | System execution of required checks and durable operation outcomes. Adapted; this does not establish improved semantic quality. |
| [Bridgewater Vault, 06:53–11:35](https://www.youtube.com/watch?v=CLve4Nx_RwI&t=413) | Useful retrieval depends on governed material, filtering, and judged examples. | One reusable evidence substrate with scoped access. Adapted without institutional corpus scale or continuous monitoring. |
| [Bridgewater PAT, 18:08–23:59](https://www.youtube.com/watch?v=lXZb21CfeIY&t=1088) | Specialized missions and execution-owned validation make required controls unavoidable. | Shared execution with mission-specific contracts. Adapted without a Python compiler or a generated analysis DAG. |
| [Hex, 09:30–20:49](https://www.youtube.com/watch?v=Xyh1EqcjGME&t=570) and [27:28–34:38](https://www.youtube.com/watch?v=Xyh1EqcjGME&t=1648) | Shared capabilities, manageable tools, and governed context matter; visible activity alone does not verify an answer. | Reusable operations, compact context, and distinct semantic controls. Adapted without a general capability framework or automatic promotion of conversational memory. |
| [Anthropic tools](https://www.anthropic.com/research/writing-tools-for-agents) and [long-running harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) | Complete operations reduce coordination, while retained incremental work supports continuation. | Controlled operations and recovery from retained domain state. Adapted without transplanting coding-agent progress files or self-improvement infrastructure. |

### Source Coverage and Limits

- All three videos: metadata, descriptions, and complete English timed transcripts retrieved through YouTube Transcript in Executor. Visual demonstrations were not independently inspected.
- Vault: the description supplied no relevant implementation resource; event promotion was excluded. Its claim that agents will find available data is not adopted as a reliability assumption.
- PAT: the description's [LangGraph page](https://www.langchain.com/langgraph) was read. Its use in PAT does not establish a need to replace the existing orchestration.
- Hex: the description's [Hex site](https://hex.tech/) was read, followed by [Context Studio](https://hex.tech/product/context-studio/) and its [evaluation account](https://hex.tech/blog/we-used-evals-to-improve-ai-feature/). Chart-format normalization is not permission to relax evidence controls. The video's long-horizon simulation remains experimental and is not adopted.
- Additional research read [Building effective agents](https://www.anthropic.com/research/building-effective-agents), the [AI SDK loop-control documentation](https://ai-sdk.dev/docs/agents/loop-control), and version-matched installed SDK source and workflow documentation. Completion conditions and safety limits are distinct; stopping a loop does not establish successful research. Reported vendor gains are not prototype quality guarantees.

## Alternatives Considered

| Alternative | Outcome and reason |
| --- | --- |
| Inspect only qualifications produced by a fixed pipeline | Not selected as the Sources agent's role. The agent conducts a documentary inquiry from the material rather than only repairing prior proposals. |
| Give an agent all preparation orchestration | Not selected. The system organizes bounded preparation; the agent's adaptive role is documentary inquiry. |
| Reserve a predicted final share of agent calls | Not retained. It introduces another calibration policy without resolving the demonstrated reading and correction defects. |
| Rely only on an agent-specific hard call ceiling | Not retained as the working model. Combine cumulative protection, complete operations, preserved work, and authorized recovery. |
| Build a new multi-session orchestration framework | Not required. Reuse existing execution and persistence owners; retain the benefits of resumable work without introducing another engine. |
| Add a complete second dossier-wide semantic review or permanent critic agent | Not selected. Submission operations control their own new contributions; Sources can also receive a targeted documentary check. |
| Detect a semantic risk before deciding whether to verify a submission | Not selected. Recognizing the case already requires semantic interpretation. The retained controls attach to known submission boundaries. |

## Verification Direction and Open Decisions

Proposed checks, not performed by documenting this conception: retrieve several windows and reread the first; correct one contribution without losing another; require a dependent control without an agent explicitly scheduling it; interrupt an operation after confirmed work and recover without repetition or counter reset; isolate an unknown provider outcome; reject a stale revision; and preserve a human checkpoint during recovery. Exercise the same business operation through native and agent entry points under equivalent authority.

Semantic evaluation must separately judge useful contributions retained, spontaneous omission detection, corrections, regressions, and completed obligations. Frozen failures are regression cases; exposed dossiers are not unseen holdouts. Structural success and lower call counts do not establish better analytical work.

The shared structure, mission/invocation distinction, ordinary handoff, continuity guarantees, loop policy and traceability boundaries were accepted on 2026-10-27. Implementation work remains for concrete schemas and bindings, context assembly and history retrieval, inspection and revision records, verifier routing, executable quality checks, non-progress criteria and numerical resource/rework parameters. These open choices sit within the accepted architecture and require resolution before activation of the affected behavior.

The implementation handoff is the `harnais-architecture` worktree, with implementation authorized separately from this conception. Within the roadmap sequence, first prove a deterministic operation and simulated-model continuation, including the failure boundaries in the [technical acceptance contract](../../../context/TECH.md#implementation-transition), then integrate Sources through existing owners. The [roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources) retains undelivered capability and sequencing; no implementation plan or new document owner is introduced here.
