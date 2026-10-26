# Agentic Execution: Retained Conception

## Status and Ownership

Accepted on 2026-10-26 after examining Sources experiments, comparing execution alternatives, and extending the selected contract to Sources, Investigation, and Synthesis. This document owns their shared execution architecture. The [global conception](2026-10-23-question-led-workbench-conception.md) owns workflow order, cooperation, inventory rules, analyst judgment, and functional outcomes. Implementation integration and semantic quality remain unverified.

The destination is an agent that can adapt its work through controlled business operations, preserve useful progress, and recover without making the analyst coordinate routine execution. This is an execution contract, not a new agent framework or a claim that model reasoning is deterministic.

## Shared Mission Contract

The system starts an authorized mission with its scope, applicable versions, allowed operations, resource constraints, expected artifacts, and progression conditions. The specialized agent chooses useful inspections, hypotheses, confrontations, and proposals within that frame. The system continues to conduct the global workflow.

```text
Mission and compact initial context
                 |
                 v
Agent chooses useful work <------------------------+
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
| Mission, research scope, questions, applicable rules, available resources, and useful current state | Supplied directly and concisely at launch or continuation. |
| Available documents, existing contributions, and prior work | Compact orientation with references; details remain retrievable. |
| Passages, surrounding context, qualifications, restrictions, and comparisons | Retrieved by the agent for the current need, with explicit reading limits. |
| Captures, inspected references, artifact revisions, operation results, and history | Retained independently of the current model context. |

The agent controls what it needs to inspect; the system supplies scoped retrieval and reproducible references. A search result is a lead, not established support. Removing text from the working context neither deletes its recorded inspection nor grants authority to unseen material. Citation use still depends on access, version, provenance, and permitted use.

Results returned on demand must not then accumulate indefinitely in every subsequent request. Working-context management preserves useful state and references while allowing older detail to be retrieved again. A summary or work note cannot replace the exact evidence it describes. Initial-context fields, reading windows, and history-management mechanics remain to be specified; no cross-dossier learning or institutional memory is introduced.

## Complete Operations and Targeted Changes

Use the [shared business-operation model](2026-10-23-question-led-workbench-conception.md#shared-business-operations-and-agent-tools): native system calls and agent bindings reach the same domain implementation and controls. Shared implementation does not grant every mission access to every operation.

The agent proposes meaningful changes with evidence and justification rather than reserializing an entire artifact to alter one contribution. The domain operation preserves unaffected content, reconstructs and controls the resulting artifact, records its revision, and handles known dependent checks. This is a business contract, not an arbitrary JSON patch interface.

The agent can identify additional useful investigations. Once a verification is required by an applicable rule or a revision's known dependencies, the system organizes its execution within the authorized envelope. The caller receives a controlled result or precise feedback instead of coordinating internal verification steps. Unfinished checks remain visible and cannot silently replace a previously usable result with an apparently verified revision.

An operation can contain bounded model-assisted work. Logical completeness does not make external calls one database transaction: confirmed intermediate results and pending obligations must survive an interruption. Diagnostics retain the actual failed field, reference, version, or execution boundary rather than hiding a syntax failure behind a generic invalid-object message.

## Targeted Semantic Controls

Structural controls at domain boundaries remain mandatory. They establish properties such as valid references and versions, not that a passage supports the proposed interpretation.

A distinct targeted semantic examination can be imposed by the system in defined situations or requested by the agent for an unforeseen difficulty. Its result remains an input to the applicable domain policy, not authority to approve the work. This does not require another permanent agent or a second model call for every result.

Controls concern the affected contribution or interpretation, its evidence, scope, and limitations. A partially examined argument cannot become fully supported because another part is plausible. Exact triggers, semantic result contracts, model routing, and correction criteria remain open. Self-review, a verifier response, and schema acceptance are each fallible; none supplies a universal truth guarantee.

## Preserved Work, Recovery, and Resources

Preserve the result and state after each operation, including incomplete obligations when an operation is interrupted. A continuation starts from that state with compact useful context; it does not depend on replaying the complete agent conversation.

Continue automatically after a recoverable technical interruption while the mandate, execution authority, applicable versions, and remaining allowances remain valid. Reuse confirmed completed work. An unknown provider outcome does not authorize blind repetition; isolate the affected work and continue independent work when permitted. Cancellation, expiry, or a changed execution generation cannot be bypassed by recovery or a late result. Otherwise, expose the stop and the work still outstanding.

Resource protection is cumulative at the dossier level under the applicable operation policies. Count actual provider calls, including agent reasoning, model-assisted business work, and semantic controls. A tool invocation is not a reliable substitute for that accounting. Continuation does not reset consumption or create another allowance.

The selected architecture does not add an arbitrary call quota for each agent or reserve a fraction of calls for a finalization phase. Normal completion follows the expected artifacts and controls. Hard resource and time limits still protect execution; they can leave work incomplete. Their numerical values and operation-specific application remain to be selected during technical integration.

Recovery cannot cross a human checkpoint or imply fresh adoption of a revised judgment. Those boundaries remain governed by the global conception rather than by the shared execution mechanism.

## Application to the Three Missions

| Mission | Agent's working focus | Mutation and control boundary |
| --- | --- | --- |
| [Sources](2026-10-24-source-ingestion-and-processing-conception.md) | Examine the available captured corpus, choosing readings and documentary confrontations within system-organized preparation. | Propose qualified documentary contributions and restrictions; preserve independent useful material and report gaps. Sources does not produce the shared analytical inventory's assertions. |
| [Investigation](2026-10-24-investigation-conception.md) | Use shared material and inventory to test interpretations across the framed questions. | Contribute controlled assertions and question-specific uses, then propose appraisals. Changes cannot silently rewrite a retained human judgment. |
| [Synthesis](2026-10-25-synthesis-conception.md) | Connect retained appraisals into an overall economic interpretation. | Preserve the joint coherence of diagram and argued note; route a necessary new premise through Investigation under the global cooperation rules. |

The shared mechanism does not merge their semantic criteria. Sources supplies qualified material; Investigation prepares the appraisals for grouped review; Synthesis uses retained judgments under the existing delivery rules. Targeted work can be incremental, while a supported synthesis still delivers its diagram and note together. The alternative non-establishment finding remains governed by the [synthesis outcome rules](2026-10-23-question-led-workbench-conception.md#synthesis-outcomes).

## Evidence and Architectural Lessons

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
| Add a complete second semantic review or permanent critic agent | Not selected. A distinct targeted control can be required or requested; exact criteria remain open. |

## Verification Direction and Open Decisions

Proposed checks, not performed by documenting this conception: retrieve several windows and reread the first; correct one contribution without losing another; require a dependent control without an agent explicitly scheduling it; interrupt an operation after confirmed work and recover without repetition or counter reset; isolate an unknown provider outcome; reject a stale revision; and preserve a human checkpoint during recovery. Exercise the same business operation through native and agent entry points under equivalent authority.

Semantic evaluation must separately judge useful contributions retained, spontaneous omission detection, corrections, regressions, and completed obligations. Frozen failures are regression cases; exposed dossiers are not unseen holdouts. Structural success and lower call counts do not establish better analytical work.

Remaining design work concerns operation signatures and mission exposure, compact-context assembly, retained inspection and revision records, semantic-control criteria, bounded recovery conditions, resource values, and executable artifact-specific exit checks. These details belong to the shared execution and domain owners.
