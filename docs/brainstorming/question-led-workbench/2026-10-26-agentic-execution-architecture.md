# Agentic Execution: Retained Conception

Follow-up, 2026-11-01: the [message-authority repair and final paid cases](../../verification/2026-11-01-workbench-message-authority-requalification.md) supersede current-status readings of analyst-field precedence and documentary registration below. Their targeted corrections pass; read-only compliance, framing usefulness and local browser execution remain unaccepted. Original observations and raw evidence are preserved.

Supersession, 2026-11-11: current `authority_native_v1` work derives model deadlines and receipt leases from remaining approved authority rather than historical 60-second/five-minute generation ceilings. Application defaults have one [resource-policy owner](../../../context/TECH.md#locked-resource-limits); native context/output management and retained evidence remain distinct. Earlier implementation values below preserve their dated meaning and grant no renewed execution authority.

## Status and Ownership

Accepted on 2026-10-26 and refined on 2026-10-27, 2026-10-29, 2026-11-01 and 2026-11-07. This document preserves dated execution rationale; the [technical contract](../../../context/TECH.md#agentic-missions-and-shared-operations) owns current obligations and the [global conception](2026-10-23-question-led-workbench-conception.md) preserves workflow rationale.

Status reviewed on 2026-10-30: Pi Durable is delivered for new mission loops, technical history and compaction, with a bounded inspection mission and simulated-provider verification. Historical Workflow executions and the analyst-facing conversation storage remain compatible. Workbench/START and the three research mission bindings remain undelivered; live model judgment and summary fidelity are not certified. See the [replacement verification](../../verification/2026-10-30-pi-durable-replacement.md) and [delivery roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources).

Supersession note, 2026-11-01: START and Workbench now bind persistent framing, explicit launch, conversational controls and the installed documentary workflow. The configured Workbench model remains inactive pending separate qualification; the three research agents remain pending. Current scope and delivery belong to [TECH](../../../context/TECH.md#implementation-transition) and the [roadmap](../../ROADMAP.md#phase-6--framing-and-controlled-transition).

Conception refinement, 2026-11-01: the user accepted [native Workbench continuity and a simpler shared model interface](#native-conversation-and-harness-refinement-of-2026-11-01). This changes the technical lifetime of new Workbench conversations. Implementation note, 2026-11-01: new conversations pin definition version 2 and reuse a native Pi conversation across response missions; existing conversations keep version 1 and their original journals. The [integration verification](../../verification/2026-11-01-native-workbench-continuity.md) supersedes the earlier pending-integration status. The original native probe below remains local exploratory evidence and does not certify live model quality.

Supersession note, 2026-11-05: the instruction refactor replaces those executable prompt variants with Workbench version 3 and Sources version 2. Each has one current composition, separated stable instructions and domain observations, and capability-aware configurable reasoning. Stored records remain inspectable; unsupported definitions cannot execute. The subsequent shared recovery correction on the same date advances Workbench to version 4 and Sources to version 3, composes the common diagnostic method and keeps full observations recoverable through compact references. The [technical contract](../../../context/TECH.md#accepted-native-conversation-and-model-interface) owns the current mechanism. Deterministic checks, local publication and protected administrative verification do not establish fresh documentary or conversational model quality.

Conception refinement, 2026-11-07: the user accepted [native context sections, qualitative compaction, targeted reading and revised future-mandate cost accounting](#native-context-and-compaction-refinement-of-2026-11-07). The [technical contract](../../../context/TECH.md#accepted-native-context-and-compaction-design) owns this target. It supersedes fixed native request/output ceilings and transport-only state injection as the intended design, while current guards remain enforced until replacement is implemented and verified. The earlier context-access table is historical where it describes contribution statements and restrictions as on-demand-only. No context/compaction correction is delivered by this acceptance.

The destination is an agent that can adapt its work through controlled business operations, preserve useful progress, and recover without making the analyst coordinate routine execution. This conception records execution choices without introducing another workflow engine or claiming that model reasoning is deterministic.

## Shared Harness Decision of 2026-10-27

> Historical runtime choice: the Workflow-based agent loop below was superseded for new missions on 2026-10-30. Its ownership and execution invariants continue under [the current technical contract](../../../context/TECH.md#shared-execution-structure).

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

The following checklist records the design handoff of 2026-10-27, before the shared runtime was delivered. Current gaps and verified capabilities belong to [the roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources); this list is not a current implementation backlog.

Proposed checks, not performed by documenting this conception: retrieve several windows and reread the first; correct one contribution without losing another; require a dependent control without an agent explicitly scheduling it; interrupt an operation after confirmed work and recover without repetition or counter reset; isolate an unknown provider outcome; reject a stale revision; and preserve a human checkpoint during recovery. Exercise the same business operation through native and agent entry points under equivalent authority.

Semantic evaluation must separately judge useful contributions retained, spontaneous omission detection, corrections, regressions, and completed obligations. Frozen failures are regression cases; exposed dossiers are not unseen holdouts. Structural success and lower call counts do not establish better analytical work.

The shared structure, mission/invocation distinction, ordinary handoff, continuity guarantees, loop policy and traceability boundaries were accepted on 2026-10-27. Implementation work remains for concrete schemas and bindings, context assembly and history retrieval, inspection and revision records, verifier routing, executable quality checks, non-progress criteria and numerical resource/rework parameters. These open choices sit within the accepted architecture and require resolution before activation of the affected behavior.

The 2026-10-27 implementation handoff designated the `harnais-architecture` worktree, with implementation authorized separately from that conception. Its sequence called for first proving a deterministic operation and simulated-model continuation, including the failure boundaries in the [technical acceptance contract](../../../context/TECH.md#implementation-transition), then integrating Sources through existing owners. The [roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources) retains current undelivered capability and sequencing; no implementation plan or new document owner is introduced here.

## Common Generation and Workbench Decision of 2026-10-29

> Superseded on 2026-10-30 by Pi Durable for new mission generation and technical continuation; see the [replacement verification](../../verification/2026-10-30-pi-durable-replacement.md). The paragraph below records the earlier selection. Workbench's product decisions and retained conversation storage are governed by the current references, independently of that runtime change.

Convex Agent was selected as the common generation and conversation layer behind the interchangeable backend contract after both real library adapters passed the recorded simulated-provider checks. The comparison and independent Oracle advice favored avoiding future conversational plumbing while preserving the shared kernel. Targeted adoption around direct AI SDK remains technically viable; existing code alone was not a reason to freeze that boundary. Neither choice eliminates Workflow orchestration or domain-owned authorization, accounting, operations and adoption. The [verification record](../../verification/2026-10-27-shared-agent-harness.md#replaceable-generation-backends--2026-10-29) owns the experimental results, not live analytical acceptance.

The subsequent Workbench discussion retained one dossier from confirmed-company framing through results, with analysis consumption at Start research. A turn can accept explicit steering while ordinary messages queue; the rigid proposal of one independent job per incoming message was not retained. This supports correction during active work while preserving clear turn boundaries and dossier context. Explicit research pause/resume and tracked domain instructions preserve analyst control without turning conversation into a second workflow authority.

The retained analyst behavior, operation families, authority, turn delivery and request contracts are specified in [PRODUCT.md](../../../PRODUCT.md#workbench-conversation-and-research-control) and the [technical Workbench contract](../../../context/TECH.md#workbench-conversation-steering-and-instructions). Concrete schemas, bindings, numerical settings and verification of these newly accepted behaviors remain implementation work; this refinement does not certify connected START delivery.

## Execution Continuation Decision of 2026-10-29

> Superseded on 2026-10-30 by Pi Durable for new mission continuation; see the [replacement verification](../../verification/2026-10-30-pi-durable-replacement.md). The following paragraphs preserve the decision as recorded on 2026-10-29, including the then-unselected Pi alternative. Current continuation, compaction and loop obligations belong to [TECH](../../../context/TECH.md#context-recovery-and-resource-accounting).

The user accepted keeping a durable Workflow boundary after each Convex Agent generation, automatic LLM compaction near context capacity, and a direct explained stop once repetition without progress is confirmed. Approval covered conception and the need to define thresholds and verify compaction fidelity before activation; it did not authorize implementation. The current obligations belong to the [shared execution contract](../../../context/TECH.md#shared-execution-structure), [context and recovery contract](../../../context/TECH.md#context-recovery-and-resource-accounting) and [loop policy](../../../context/TECH.md#loop-prevention); the [roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources) tracks the undelivered work.

The choice extends the existing durable loop rather than treating one generation per invocation as a restriction on mission length. Diagnosis found a response-batch bound reused as a recovery-queue limit and a history-page bound reused as an active-message limit. Increasing those constants or routinely refusing the twenty-first message was not retained as the architectural remedy. Pi's [loop](https://github.com/earendil-works/pi/blob/f09d01b85e0384647fcab6779d35ab9dabe04be3/packages/agent/src/agent-loop.ts) and [compaction](https://pi.dev/docs/latest/compaction), and DeepSeek Harness's [loop contract](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/core/agent-loop/README.md), informed the distinction between continuation, context projection, concurrency and application budgets; neither runtime was selected as a replacement.

Three alternatives were compared but not selected as the common baseline: multiple Agent generations within one Workflow action would move recovery guarantees inside that longer action without an established benefit; background context preparation would add coordination before compaction latency has been measured; episodes reconstructed primarily from domain state would depend more heavily on that state's completeness for conversational nuance. None was established as technically impossible. No additional independent review, runtime acceptance or summary-fidelity experiment was performed for this decision.

## Native Conversation and Harness Refinement of 2026-11-01

### Destination and Accepted Path

Accepted by the user after the native-conversation comparison and clarification of conversation, application mission and Pi execution lifetimes. Improve the shared harness with Workbench as its first validation case, using Pi Durable's existing mechanisms instead of rebuilding conversation, steering or compaction. Convex remains the business authority. The [technical contract](../../../context/TECH.md#accepted-native-conversation-and-model-interface) owns the accepted boundaries and verification requirements; the [roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources) records pending delivery.

The selected attachment keeps one native Pi conversation across successive Workbench responses while retaining the application's bounded response missions. For example, a framing proposal and the analyst's later question about that proposal become successive executions in the same native conversation. Creating the second application mission does not recreate the conversation or discard its history. The choice reuses current mission completion, authorization and recovery semantics; each native task still belongs to its original authorized work.

The accepted model interface removes mechanical bookkeeping from model choices: operation arguments come from the observed invocation where unambiguous, while the model selects substantive content and explicit observed targets. Workbench's final prose is converted into its typed result by code; definitions needing structured references retain strict output. Control-only confirmations are domain-generated from recorded effects. These choices preserve an adaptive loop and reduce avoidable serialization/version-selection errors without claiming deterministic economic reasoning.

### Research Evidence and Limits

Inspection on 2026-11-01, before this refinement was implemented, covered the [conversation owner](../../../convex/execution/conversations.ts), [Pi adapter](../../../convex/integrations/piMission.ts), [storage binding](../../../convex/integrations/piStorage.ts), [writer lease](../../../convex/execution/piStore.ts), [context assembly](../../../convex/execution/context.ts), [reply decoding](../../../convex/execution/invokeAgentModel.ts) and Workbench definition/contracts. The installed adapter creates a mission for each response and keys Pi storage by mission. Earlier analyst exchanges remain available through application history, which does not establish continuous native context across response missions. Instructions occur in multiple request-construction layers, active messages retain their original delivery label, final prose encounters a JSON decoder, and mechanical revision/message fields are model arguments. The [Nemo qualification](../../verification/2026-11-01-workbench-nemo-qualification.md) preserves the failed route/configuration evidence; these observations do not isolate each mechanism's contribution or prove that the same model becomes useful after a harness change.

Pinned primary sources showed [Pi Coding Agent admitting real user messages](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/agent-session.ts#L1944-L1975), [steering and follow-up continuation](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/agent/src/agent-loop.ts#L174-L326), and [compaction-aware session projection](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/session-manager.ts#L439-L511). T3 Code's inspected Codex adapter sends [new inputs and targeted steering to a native thread](https://github.com/pingdotgg/t3code/blob/460b88bc425f41ed5e7b5208a64b448f34098b9b/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L7108-L7164) and [restores separate application context after compaction](https://github.com/pingdotgg/t3code/blob/460b88bc425f41ed5e7b5208a64b448f34098b9b/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L1675-L1705). No commit equivalence with the running T3 installation was established. Message roles alone are not an injection defense.

A local probe exercised installed Pi Durable 1.4.0 with native temporary SQLite storage, nine simulated responses and no network access. The same native root and provider-session identity survived three openings; a repeated request ID caused no additional generation; earlier user/assistant messages remained in the next response context; compaction preserved originals and its summary survived reopen. This SQLite probe is an isolated library experiment, not a proposed application storage replacement or a Convex integration test. Its command was `node --input-type=module < /tmp/workbench-pi-native-continuity-20261101-spike.mjs`; the result and observations are under `/tmp/workbench-pi-native-continuity-20261101-O7TRbr/`. These are temporary local artifacts, not an archived repository verification record.

The probe falsified direct equivalence between native queue modes and the application response contract. After a tool round, native steering joined the active run while follow-up waited. At a tool-free final answer, Pi settled the original run and started another with the selected steer and follow-up together. Application admission and stale-publication controls therefore remain necessary. The retained probe results reference the earlier failed assumptions; native continuation is not itself evidence that Workbench's analyst-facing boundaries are satisfied.

### Compared Alternatives

| Path | Retained outcome and reason |
| --- | --- |
| Extend the adaptive Pi loop and existing domain owners | Accepted. Preserves result-driven investigation while assigning known mechanics to code. |
| General exploration/proposal phase followed by a separate application phase | Not selected. Adds a general lifecycle phase without a demonstrated need for every interaction; grouped artifact operations remain possible. |
| Prescribe the entire research sequence and use models only for fixed tasks | Not selected as the shared baseline. Suitable for stable mechanical tasks, but requires more predefined branches for adaptive documentary inquiry. |
| Keep each response's native session isolated and reconstruct context from application state/history tools | Not selected. Does not meet the user's intended native continuity across responses. |
| Keep one permanent Workbench application mission | Technically possible, not selected. Requires changing mission closure, deadline and recovery semantics instead of preserving existing response boundaries. |
| Require every conversational final response to generate a JSON envelope | Not selected. Code can construct Workbench's text envelope while preserving typed internal results and strict structured definitions. |

### Remaining Verification and Handoff Boundary

Later checkpoint, 2026-11-01: the original handoff status below is historical. The [current technical contract](../../../context/TECH.md) and [post-repair qualification](../../verification/2026-11-01-workbench-contract-repair-and-qualification.md) distinguish delivered native mechanics from blocking analyst-edit precedence and documentary interpretation. Neither the implementation nor passing transport checks establish complete business acceptance.

The attachment to Convex, original-task fencing across response handover, late steering, queued-message exclusion, interrupted publication/recovery, tool projection and completion conversion remain unimplemented. The accepted checks are owned by [TECH](../../../context/TECH.md#accepted-native-conversation-and-model-interface). Retained sessions and historical outcomes cannot be reassigned implicitly, and replay cannot establish how a model would choose tools under changed context.

The user accepted 32 MiB for the whole durable Workbench Pi journal, with an explicit capacity stop. Trials showing insufficient conversation capacity trigger another storage decision; deleting originals, resetting consumption or silently recreating a conversation are not remedies. Summary fidelity and economic usefulness remain separate quality questions. The design selects no new model/provider, changes no application activation and authorizes no further paid lot. No implementation plan was created.

## Native Context and Compaction Refinement of 2026-11-07

### Destination and Accepted Path

Status update, 2026-11-07: the native-section, complete contribution/continuation, fragmented retention and future accounting-policy mechanisms have been implemented locally. [TECH](../../../context/TECH.md#accepted-native-context-and-compaction-design) owns the current contract and [Phase 7](../../ROADMAP.md#phase-7--shared-execution-and-sources) owns delivery and remaining qualification. The evidence and unimplemented-state descriptions below describe the inspected pre-change checkout; they do not assert current runtime behavior. Deterministic mechanisms do not establish provider summary fidelity or explain the earlier GLM loop.

Accepted by the user after code-based brainstorming. Workbench and Sources should resume useful work after compaction or restart with current authority and completed work available, exact documentary material recoverable and qualitative continuity preserved. This is accepted conception for a future implementation plan, not implementation acceptance or execution authority. Current obligations are maintained in [TECH](../../../context/TECH.md#accepted-native-context-and-compaction-design); [Phase 7](../../ROADMAP.md#phase-7--shared-execution-and-sources) records pending delivery.

The selected combination uses native Pi prompt sections for the existing Convex state projection, native history/compaction for qualitative working memory, and targeted documentary reads with exact references and continuations. Current controlled contribution statements and restrictions return automatically; exact quotations remain available on demand. This avoids asking the model to reconstruct authoritative effects from a lossy summary while retaining Workbench's conversational hypotheses, nuances and exploration history.

The user explicitly included replacement of the fixed 128 KiB native request ceiling, preservation of effective native output budgets, compaction when necessary with anticipation disabled, complete retained payloads through the existing storage owners, and reservation followed by settlement to a known final cost for future mandates identifying that accounting policy. Unknown or partial costs keep their reservations. The [earlier qualification envelope](../../decisions/024-qualify-source-content-before-corpus-approval.md#bounded-reading-and-durable-execution) explains the original bounded-document use of 128 KiB; the examined record supplies no measured derivation for that exact value as a native conversation limit. One-shot qualification/comparison remains a distinct contract.

### Evidence and Its Limits

Status update, 2026-11-08: the [current native contract](../../../context/TECH.md#accepted-native-context-and-compaction-design) now specifies ordered application observations committed with effects, internal native delivery and checkpoint proof, legacy current-state anchors, and ordinary model/SDK output defaults. These supersede the remaining transport-only continuity and ordinary 6,144-token fallback described in earlier implementation states. Original failed qualification evidence remains unchanged; local correction does not establish fresh provider quality.

The [real Sources preparation report](../../verification/2026-11-07-sources-real-preparation.md) retains the two failed lots, exact configuration, costs and native archive links. DeepSeek's last compaction reached the imposed 6,144-token output ceiling and ended with length; GLM retained controlled contributions before rereading already adopted history fragments and stopping without progress. Compaction preceded that loop, but its causal role remains unproved. Neither restoring defaults nor adding references alone establishes useful completion.

Inspection found an existing state assembly in [execution context](../../../convex/execution/context.ts), domain projections in Workbench/Sources, shared immutable observation references in the [journal](../../../convex/execution/journal.ts), and an existing [provider receipt and charge-reconciliation owner](../../../convex/providerCalls.ts). Required state was already injected before business generation, but only at transport time, after native capacity estimation. The adapter and payload preparation each overwrite native output limits. Documentary search returns exact passages with explicit omissions but no continuation for omitted results; Sources' contribution previews are incomplete, and its reading references do not directly expose the existing journal reference.

The installed Pi Durable/Pi AI 1.4.0 source shows native prompt sections rendered before capacity estimation, with replacement by section key and native system-state restoration after compaction. A render error retains the previous section by default, so mandatory-state failure requires an explicit stop. Native summarization also trims individual tool-result text before summarizing; its memory cannot be the only route back to exact observations. Session-only probes with scripted responses observed section replacement, automatic compaction, section availability afterward and transmission of the native summary output budget. They are exploratory mechanism evidence, not archived integrated verification, crash-recovery proof or semantic-fidelity acceptance.

### Alternatives and Trade-offs

| Integration | Decision and reason |
| --- | --- |
| Keep transport-time state injection and adapt the final capacity check | Viable but not selected by the user. Keeps state addition separate from native preparation and requires maintaining that adaptation. |
| Supply the existing Convex projection through native prompt sections | Accepted by the user. Lets Pi account for the state during preparation while Convex retains construction, admission and authority. |
| Publish a synchronized projection after every domain change | Not selected for this prototype. Requires covering every relevant update path without a measured reconstruction cost that justifies the extra synchronization. Reconsider only if that cost becomes material. |

Replacing qualitative compaction with structured state alone or adding a separate execution worker was not selected. Complete automatic contribution statements deliberately use more required context than previews. Exact quotations remain selectively read; mandatory state that cannot fit still stops explicitly. Anticipatory compaction remains a viable later latency trade-off, conditional on verified concurrent task/receipt correlation. No new consultation quota or per-agent call allocation was selected.

### Validation and Handoff Boundary

The accepted validation direction exercises useful domain outcomes after reading, compaction and reopen, rather than only checking identifier presence. It covers current contribution statements/restrictions, qualitative-versus-authoritative distinctions, exact passage recovery, stale preparation, final wire options, complete large-payload retention, interrupted/idempotent persistence, cancellation and known/unknown/partial/late cost settlement. [TECH](../../../context/TECH.md#accepted-native-context-and-compaction-design) owns these gates. Semantic summary fidelity and the GLM loop's cause remain open; initial reservations can remain conservative without a verified exact pre-call token count.

Documentation records acceptance only. No production code, dependency, environment, deployment or dataset change, commit, or paid evaluation was authorized. Earlier financial mandates are closed and expired. Historical accounting, records and frozen evidence remain unchanged; a new qualification requires a new applicable mandate. Preparation of an implementation plan and its execution are separate next authorizations.
