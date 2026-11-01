# Technical Contract

## Authority and Boundaries

This document owns architecture, persistence, workflow, provenance, providers and security. [PRODUCT.md](../PRODUCT.md) owns analyst behavior and acceptance; [AGENTS.md](../AGENTS.md), development and verification; the [roadmap](../docs/ROADMAP.md), delivery evidence and activation. Unfinished contracts remain requirements, not delivery claims. ADRs preserve rationale without adding obligations. Find implementation locations in the repository; this document is not a code or test index.

TanStack Start owns web/SSR with strict TypeScript, React and shadcn. Convex owns domain policy, persistence, reactivity, artifacts, audit and quotas. Pi Durable owns new agent mission loops and technical checkpoints on Convex storage and scheduling. Convex Workflow retains documentary/research orchestration, human waits and pinned historical agent executions. Pi native transport and Vercel AI SDK adapters share the application admission and accounting boundaries. Retrieval uses native Convex search; optional hosted embeddings add no state owner.

Separate domain records, persistence, orchestration, acquisition/normalization, model routing, analytical policy and UI projections. Evidence policy stays out of UI and SSR; provider types and model identifiers stay behind adapters/configuration. CIK is canonical company identity. Mutable tickers, names, exchanges and provider metadata cannot identify retries, associations or duplicates unless a deterministic fixture owns them.

Pi replaces new agent execution machinery rather than adding another business workflow engine. The baseline excludes PostgreSQL, separate object storage and custom realtime transport. Eve or Vercel Workflow require demonstrated need and an explicit decision. Vercel Hobby is acceptable only within verified limits; free hosting is not promised. Model routes, credentials, resource settings, showcase identity and deployment URLs remain configuration.

### Local development

Native configuration and instance identity identify each worktree's Convex deployment and state. A locked `local-runtime-ports.json` in the common Git directory reserves fixed ports for Convex, its site endpoint, the development frontend, build preview and Playwright capture service. Registration preserves configured native ports and verified frontend listeners, then assigns the first unreserved deterministic set. Reservations survive service shutdown, readiness cleanup and machine restart. An occupied port fails explicitly; startup never selects another.

`pnpm dev:ports` lists reservations offline. Explicit `dev:web --port` or `PORT` for `dev:browser` updates the assignment after checking reservation conflicts; port zero is invalid. Native ports are mandatory CLI arguments. A repository-wide lock serializes native startup through identity verification.

An ignored runtime manifest records verified live origins and owned processes without secrets. Development commands and protected browser tests resolve these worktree-specific origins. Cleanup removes only invocation-owned process/readiness entries, never reservations. Startup and publication have separate bounded process budgets. The native startup timeout defaults to the launcher budget. Native interruption invokes SDK cleanup.

## AI Use and Deterministic Execution

Model assistance may serve any explicitly defined phase, including framing or query planning before acquisition. Each task or mission needs a purpose, expected result and reason for semantic interpretation. Keep reliable lookups, validation, counts, transitions and formatting deterministic.

Before activation, define allowed inputs, output use and execution conditions. All dispatch, including reasoning and controls, follows [provider boundaries](#provider-boundaries) and [cumulative accounting](#context-recovery-and-resource-accounting). Code authorizes work; no model decides whether a routine operation needs AI. Adaptive reasoning and mandatory submission controls do not require verification of every action.

Pre-acquisition framing and hypotheses establish no company facts. Assertions require admissible evidence and controls. Model permission neither starts Sources/Investigation before Start research nor bypasses analyst prerequisites or activates providers. Existing restrictions follow the [implementation transition](#implementation-transition).

## Agentic Missions and Shared Operations

Workbench frames the dossier, handles analyst conversation and transmits authorized instructions; Sources conducts documentary inquiry; Investigation contributes assertions and investigates framed questions; Synthesis connects retained appraisals. The system defines authority, scope, versions, operations, resource bounds, artifacts and progression. Agents choose readings, confrontations and proposals from mission start, without a risk-trigger prerequisite. All roles use the shared harness; business workflows retain phase transitions. Generation backends implement that shared protocol; no additional workflow engine or general capability framework is selected.

Native calls and agent tools share domain-owned operations: input/result schemas, validation, policy, versions, persistence, effects, reuse and known dependencies. Tool bindings derive their schema and add description/execution binding. Server context grants authority; model arguments cannot. Each mission receives only its permitted operations.

| Business operation | Domain responsibility | Agent exposure | Controlled result |
| --- | --- | --- | --- |
| Consult mission state | Dossier and preparation | All four roles within their scope | Compact scope, versions, references, progress, restrictions and pending work. |
| Search available material | Documentary material | All four roles within their scope | Candidate passages, reproducible references and search limitations. |
| Read in context | Documentary material | All four roles within their scope | Exact passages, surrounding context, observed links and applicable restrictions. |
| Adjust proposed framing | Framing | Workbench | Version-controlled draft changes preserving explicit analyst adjustments, before Start research. |
| Transmit an analyst instruction | Workflow | Workbench | A tracked domain request linked to its original message and interpreted need. |
| Pause or resume research | Workflow | Workbench on explicit analyst request | Controlled suspension or authorized resumption, preserving work and human prerequisites. |
| Make a source consultable | Sources | Sources | Acquired or reused content with its own capture and provenance. |
| Submit documentary qualification | Sources | Sources | Document contributions and restrictions with targeted diagnostics. |
| Request a targeted documentary check | Sources | Sources | A statement's documentary support, scope and limits, including before qualification. |
| Contribute to the inventory | Shared inventory | Investigation | Assertions, corrections and question-specific uses admitted under shared rules. |
| Request a documentary complement | Workflow | Investigation | Grouped decisive needs transmitted within the single permitted phase. |
| Submit appraisals | Investigation | Investigation | Controlled responses by question, proposed for grouped analyst review. |
| Request analytical re-examination | Workflow | Synthesis | A concern or necessary new premise routed to Investigation for available-material examination. |
| Submit synthesis | Synthesis | Synthesis | Jointly controlled mechanism diagram and argued note, or reasoned non-establishment. |

These entries define operation responsibilities and families, not frozen SDK signatures or a generic API. Consultation, explicit-query search, exact reading and handoff authorization use deterministic checks. Search/reading enforce mission access and permitted uses. Workbench cannot directly establish inventory assertions, appraisals or synthesis, or take the analyst's Start research and appraisal-adoption decisions. Completion refers to artifacts without another coordination tool.

Consultable sources require an authorized candidate or observed link with recorded origin and retained destination content. A URL, index label or guide proves no destination reading or qualification. Sources returns qualified documents; Investigation creates inventory assertions.

### Shared Execution Structure

The executor centralizes execution guarantees; existing domains retain business knowledge. These boundaries do not require one file per concept.

| Code boundary | Single responsibility owner |
| --- | --- |
| `convex/execution/` | Shared execution contracts, mission lifecycle, operation requests and outcomes, suspension/continuation, repetition controls and causal trace references, with Pi Durable for new agent missions and retained Workflow drivers for historical missions. |
| Static versioned agent definitions | Mission instructions, context construction, allowed operation references and domain-owned result/completion criteria. Concrete models remain routing configuration. |
| Existing domains and integrations | Business operations, semantic criteria, evidence and artifact models, acquisition, provider adapters, attempt receipts and cumulative accounting. Extend these owners rather than introducing a parallel retry or budget subsystem. |

Add agents through the typed `AgentDefinition` contract and static schema/runtime catalogues, without editing the execution driver. Definitions own scope/state/result schemas, instructions, context, preconditions, permitted operations, progress and completion. The executor validates their outputs and alone applies lifecycle transitions; definitions cannot return arbitrary mission patches. Native callers and generated tools share operation contracts, versions and dispatch. Mission-state/history consultation is common; corpus approval and capture integrity belong to saved-material inspection. Dynamic plugins and workflow languages are excluded.

New agent missions pin `pi-durable` version 1, using `@earendil-works/pi-durable`, Pi AI and Chord 1.4.0. Pi owns the generation → tools → retained results → next generation loop, durable task checkpoints, technical conversation and automatic compaction. Convex owns persistence, scheduled host wakeups, authorization, domain operations, accounting, adoption and publication. The native Pi model transport uses the same canonical operation schemas, route restrictions, attempt admission, receipts and observable journal as one-shot generation; no second agent loop or operation catalogue surrounds it. Provider-specific types stay inside the integration.

Each mission has one append-only Pi commit log and a fenced writer lease. Persist commits before applying the library's in-memory read projection; an acknowledgement loss recovers the identical committed key. A transient append retries that same idempotent commit once, without repeating model or business work. Claim the writer and arm its recovery wake transactionally before execution; renew its 90-second lease every 25 seconds. A replacement worker must acquire a newer epoch after expiry. Persisted sleeps and bounded host slices reopen the same Pi task history. Deferred operations yield the host with a resumable checkpoint, wake on an authorized retained result, and keep a 30-second recovery check. A result notification survives a busy wake and the preceding writer's closure. A wake delivered after the mission deadline records its explicit block and notifies any waiting parent. Drain and rebind retained operations in bounded batches without making batch size a total queue limit. Late work prevents completion; its retained proposal remains reusable after outstanding operations settle.

Retained missions without Pi runtime metadata keep their registered Workflow drivers and pinned generation adapters. Convex Agent versions 1 and 2 and historical direct AI SDK generation remain available for those records; absence of metadata never migrates a retained execution. Child missions inherit their parent's backend. Unknown identities block before dispatch without fallback. Existing documentary/research Workflows and human checkpoints remain active. Qualification/comparison retain their bounded one-shot AI SDK protocols and shared journal; the analyst-facing conversation keeps its existing message storage independently from Pi's technical log.

The delivered business definitions include approved saved-material inspection and Workbench framing/follow-up. Local numeric and conversational fixtures exercise the same Pi executor, deferred operations, steering and bounded mission returns with simulated model replies. They have no paid provider receipts. Sources, Investigation and Synthesis remain business integrations. No live agent route is enabled by this replacement; model-backed summary fidelity and analytical quality remain separate acceptance work, recorded in the [replacement verification](../docs/verification/2026-10-30-pi-durable-replacement.md).

Installed Pi limits are sequential tool dispatch, a cumulative 15-minute dossier window, 60-second model attempts, 6,144 output tokens, 128 KiB complete request including context/schema, 16 KiB notes, 64 KiB operation results and 20 events per history page. The four-request response and recovery-queue limits apply only to retained Workflow missions. Three consecutive turns without domain progress stop a mission; search progress counts distinct inspected passages, not result-set combinations. Required-context overflow blocks explicitly. Context, transaction, replay-memory and cumulative-consumption bounds are separate controls, not total queue or conversation limits.

Existing dossier work/incident accounting owns consumption, including compaction; resumes preserve it, repetition state and deadline. Retain confirmed observable model output before Pi or Workflow adoption for reuse without another paid call. Unknown dispatched outcomes cannot be replayed blindly. Cancellation fences the dossier immediately, then schedules bounded, traceable request/mission cleanup independently of volume.

### Mission Lifecycle and Operation Handoffs

| Execution concept | Retained identity and state |
| --- | --- |
| Agent definition | Static identifier/version, instructions, operations and result criteria. |
| Durable mission | Stable identity, dossier, objective, authorized scope, applicable versions, obligations, result references and continuation state. |
| Workbench turn | Active conversational request and steering references, instruction version, correlated mission work and published outcome; distinct from the dossier's research duration. |
| Temporary invocation | Mission or bounded-task reference, agent/task version, actual supplied context and provider-attempt reference. It ends when it returns control. |
| Operation request | Causing invocation or system action, operation/version, validated arguments or input references, expected domain versions, logical identity and explicit outcome or pending obligation. |

Missions and retained work are durable; JavaScript instances and hidden reasoning are not. New missions use protocol version 3 with typed scope/state/result and a research or conversation execution scope. Isolated compatibility preserves flat inspection records and protocol version 2 without rewriting identities, double writing or migrating historical data. Registered legacy function paths and Workflow step names remain available; new executions pin Pi runtime version 1 alongside the version 3 domain protocol. One-shot tasks retain their protocols and shared invocation tracing. Unknown definition versions block explicitly.

Ordinary handoff suspends between operations: retain the request and its wait correlation before effects, execute, preserve the observed result or pending state, then authorize continuation. Pi wakeups or retained Workflow events trigger a state check; early or duplicate delivery cannot repeat the operation. Waits expire under the mission deadline or a fixed 15-minute native-request deadline, retaining an unknown outcome until a factual result arrives. Business operations alone grant bounded child missions, with causal request/result references and cumulative return bounds; no unrestricted spawning tool exists. A paused or recoverably interrupted child remains pending. Semantic checks remain domain-owned.

A native framing or research-control effect retains its validated success receipt and exact resulting domain pin in the same transaction as the write. Dispatch can recover that receipt without repeating the effect; adoption still checks current authority, instructions and the resulting revision. Research controls also fence intervening pause-intent changes, including changes that do not advance execution generation.

Every requested operation receives an outcome. Reuse preserves the original effect identity and records the current caller and instruction references. Confirmed effects are not redispatched; only proven non-dispatch permits fresh admission. Refused adoption retains the observation for a new authorized continuation. Mutations default to sequential execution with version checks after each effect; stale/conflicting requests return diagnostics. Independent reads may use bounded concurrency. SDK tools cannot bypass dispatch or introduce implicit concurrent mutations. Completion waits for outstanding operations, including native work admitted during generation, before validating domain artifacts under the [workflow contract](#workflow-and-revision-contract).

Cancellation fences adoption and future work, including late results. Research continuation uses the dossier's existing visitor execution slot. A resume that makes research running atomically claims that slot and advances execution generation. Conversational work follows [phase-aware authority](#admission-and-execution-authority) without falsely marking research running.

## Workflow and Revision Contract

```text
Company confirmation after admission → persistent framing dossier
→ proposed activity, questions and mandate in the same dossier
→ optional refinement → explicit Start research
→ Sources: shared documentary preparation
→ Investigation: common inquiry and shared inventory contributions
→ when useful: one grouped bounded documentary complement by Sources
→ Investigation: re-examination and appraisals
→ grouped analyst review of identifiable appraisal versions
→ at least one retained appraisal → autonomous Synthesis
→ jointly controlled diagram and note, or reasoned non-establishment
```

Start research atomically validates the current framing, admission, analysis capacity and research execution slot, fixes the framing, consumes one analysis and launches Sources idempotently. The dossier already exists in framing and retains its identity. Sources and Investigation cannot start before this action. Target source selection follows the product mandate without routine corpus approval. Versioned authority, permitted uses, admission, rejection, integrity and audit remain mandatory. Specify the mandate, exception thresholds and persistence transition before activation.

For framed dossiers, the fixed framing is the authoritative research context for discovery, filing selection, qualification, passage retrieval and documentary complements. The original request remains history; legacy dossiers retain their existing research angle.

Initial preparation cannot consume the later complement to fill source roles; observed-link following stays within initial authority. Investigation groups decisive cross-question needs into one optional dossier-wide complement with bounded searches/readings. Synthesis re-examines available material only, without another documentary phase.

Grouped review binds human decisions to identifiable appraisal versions. Unreviewed proposals cannot become retained by default. With none retained, stay at review without Synthesis or documentary-insufficiency conclusions. Material changes to retained judgments require targeted human intervention; recovery or favorable controls cannot adopt them.

Completion validates current artifacts, references, controls, versions and prerequisites; model termination or success messages prove nothing. Each need/check requires an outcome. Finding a passage does not complete examination; unfinished checks block dependent uses while independent work continues. Distinguish partial work, justified insufficiency, pending judgment, technical incompleteness and synthesis non-establishment. Exhaustive omission detection is not promised; business mission lifecycle/completion schemas remain implementation work.

### Workbench Conversation, Steering and Instructions

Company confirmation after admission creates the framing dossier and associates its analyst-facing conversation. Conversation and direct controls use the same versioned framing operations. Clear refinements update the visible draft with an explanation; preserve explicit analyst edits and reject stale changes. Start research fixes the framing rather than creating a replacement dossier. Messages reference domain-owned framing, requests, decisions and artifacts; conversation text and framework message status are not their authoritative state. The analyst-facing thread is distinct from technical invocation storage and journal snapshots.

A Workbench turn may span several model invocations and operations through the common mission protocol. It ends when its conversational response or clarification is ready, independently of continuing research missions. Persist incoming messages and their delivery intent. During an active turn, ordinary messages queue for a following turn and do not alter its active instructions. Explicit Steer joins the active turn immediately. An already-dispatched call retains its input; the next invocation receives the steering message and retained useful work before the turn finishes. Check active-instruction and artifact versions before further operation dispatch and proposal adoption or publication. A queued message alone does not invalidate the current turn. Turns and steering never reset cumulative dossier consumption.

Persist transmitted analyst instructions through the existing domain-operation boundaries: original message, Workbench's interpreted need, target, applicable framing/phase/versions, correlation and explicit outcome. Check authority and remaining permitted work before dispatch. Return registration or transmission separately from completed treatment. The system presents eligible requests at the receiving mission's controlled continuation; unsupported or exhausted work returns an explained limitation rather than reopening a documentary phase. During an analyst pause, requests may be recorded but their research execution waits for Resume. No general inter-agent message bus or second operation catalogue is required.

An explicit analyst pause prevents new research operations while allowing an already-engaged operation to finish and its observation to be retained. Remaining controls and current versions govern later use. Workbench can discuss existing material and record instructions during that pause. Resume requires explicit analyst intent and all remaining human prerequisites; returning research to running also requires its execution slot. Steering affects the conversational turn and does not itself pause research. Pause is distinct from cancellation and cannot erase completed work or prior decisions.

## Semantic Controls and Analytical Outputs

Each domain boundary checks authority, schema, references, hashes, versions and reproducible quotations. Qualification, inventory assertions/uses, appraisals and synthesis require targeted semantic controls regardless of predicted risk. Consultation, search, reading and handoff need no extra verifier. Sources also offers targeted documentary checks.

Verification is bounded model work under shared capability/policy, without a permanent critic or second research pass. Record the examined object/use, evidence versions, rules, scope, conclusion and limits. Distinguish incomplete execution from insufficient support. Return precise field/reference/version/execution diagnostics to the responsible mission; verifiers cannot silently rewrite proposals. Successful partial checks confer no authority on unexamined content.

| Boundary | Semantic responsibility |
| --- | --- |
| Documentary qualification/check | Passage fidelity, period, modality and attribution; coherence of contributions and restrictions; comparison of genuinely comparable statements. Distinguish supported, documentary conflict, not established and technically unfinished. No economic interpretation is established merely by qualification. |
| Inventory contribution | Evidence and permitted use; Fact/Inference/Hypothesis/Unknown classification and company/activity/temporal scope; rationale for each supporting, opposing or contextual question use. Admission precedes use, not appraisal submission. |
| Appraisal submission | Reasoning from assertions through assumptions and mechanisms to possible economic consequences; rival interpretations, objections and decisive unknowns genuinely constrain the conclusion. Every assigned question receives an appraisal or justified insufficiency after inquiry. |
| Synthesis submission | Justification of new relationships and transversal inferences; fidelity between the reference diagram and the fully reasoned note; scope, conditions, evidence and limits of an alternative non-establishment finding. |

Reuse controls only for referenced, unchanged objects/uses with valid evidence versions, rules and restrictions. Recheck authority/references deterministically. New uses, modified assertions and resulting-artifact coherence need their own examination; unrelated revisions do not invalidate every control. No model adjudicates equivalence between reworded assertions. Documentary support cannot validate new inferences, nor retained appraisals new synthesis arrows.

The shared company inventory separates canonical assertions from question-specific uses; useful context needs no forced link. Evidence presence, including Unknown links, does not answer questions. Documentary integrity, admissible use and human adoption are separate authorities. Assertion identity, correction propagation and freshness schemas remain open; no complete incremental dependency engine is selected.

Operation owners preserve unaffected content, reconstruct changed artifacts and run known dependent checks. Callers cannot arbitrarily patch JSON or rewrite whole artifacts. Adverse findings restrict affected uses and flag known dependents; they do not invalidate the whole dossier. Positive findings retain objections and explain their resolution.

Synthesis may verify evidence and explain relationships. Necessary uninstructed premises return to Investigation for inventory admission and appraisal effects: a proposed revision or reasoned maintenance. Material human revisions remain pending explicitly. A limited diagram/note may be delivered together only if the unaffected base supports coherent, useful scope; contested central premises block delivery. Non-establishment requires an instructed retained base, not empty review, technical interruption or pending judgment. No routine final approval checkpoint applies.

### Analytical Control and Question Outcome Contracts

[ADR-026](../docs/decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md) records the accepted architecture. Investigation appraisal control, joint Synthesis control and the question-outcome projection remain unimplemented; this section defines their target contracts rather than claiming delivered verifier quality.

Appraisal submission and Synthesis submission each expose one artifact-family operation that owns bounded input preparation, deterministic admission, semantic examination, finding validation, disposition, exact-result reuse and affected-use restrictions. Callers submit the artifact and its declared basis; they do not coordinate a chain of validators or adopt raw model output.

| Contract part | Accepted specification |
| --- | --- |
| Authorized inputs | Submitted artifact and declared scope, exact artifact/evidence/rule/restriction versions, admissible uses and applicable human decisions. Synthesis additionally requires eligible retained appraisal versions. |
| Deterministic checks | Check authority, schema, references, hashes, versions, prerequisites, permitted uses and applicable restrictions before any model dispatch. Reject stale or unauthorized input without inference. |
| Model task | Examine only the semantic responsibilities left after deterministic checks and return closed, scoped findings tied to affected assertions, assumptions, objections, unknowns, relationships or output elements. The model neither rewrites the proposal nor grants workflow authority. |
| Initial disposition | Map validated findings deterministically to `admissible` or `revision_required`. Any material unresolved finding requires revision. A limited result is admissible only when the submitted reasoning already exposes and obeys that limit. |
| Later restriction | Reserve `restricted` for a later adverse control affecting an already retained or usable result. Restrict the affected use and flag known dependents without rewriting history or invalidating independent work. |
| Reuse identity | Reuse only an unchanged artifact/use with unchanged evidence, rules and restrictions. Modified reasoning, new use or joint-output coherence requires examination; no model decides semantic equivalence for reuse. |
| Technical failure | Missing route, timeout, interruption and unknown provider outcome produce technical incompleteness under existing invocation, accounting and recovery contracts. They cannot become semantic revision, justified insufficiency or admissibility. |
| Evaluation | Cover unsupported inference, scope overreach, ignored counter-evidence or alternatives, unknowns that fail to constrain a conclusion, unjustified insufficiency, stale input, partial examination, technical failure, unsupported Synthesis relationships, unadmitted premises and diagram-to-note divergence. Keep exact findings and acceptance thresholds versioned with the implemented contract. |

Appraisal findings localize defects in the path from assertions through assumptions and mechanisms to the proposed consequence, including the treatment of rival interpretations, objections, scope and decisive unknowns. Synthesis findings localize unsupported relationships or transversal inferences, necessary premises that lack Investigation admission, hidden conditions or limitations, diagram-to-note disagreement and an unsupported non-establishment basis. These responsibilities constrain the closed implementation schema without prescribing provider wording.

Existing `deriveQuestionCoverage` and matrix `questionCoverage` remain evidence-presence projections, including when the only linked claim is `Unknown`. Add a separate materialized question-outcome projection owned by the Investigation domain. Rebuild the affected projection transactionally when an authoritative appraisal artifact, control result or append-only analyst review decision changes. Those source records remain authoritative; the projection is a reproducible read model, and clients do not derive workflow gates.

The projection preserves evidence presence, analytical result kind, control state and human review state as separate facts. Do not store a generic `answered` boolean. A controlled substantive appraisal completes preparation and exposes a proposed answer; only its exact analyst-retained version becomes a retained answer and eligible Synthesis input. Controlled justified insufficiency also completes preparation, but is neither an answer nor a retained appraisal and contributes only a visible limitation. Technical incompleteness, unperformed work and `revision_required` do not complete preparation.

Grouped review is available only when every assigned question has an admissible substantive appraisal or admissible justified-insufficiency result. Synthesis requires at least one retained substantive appraisal. An empty retained set remains at review. Retaining the evidence-presence count does not implement this projection, and the [product's answer labels and dependent transitions](../PRODUCT.md#evidence-matrix-and-analytical-review) remain blocked until the projection and its gates are verified.

## Context, Recovery and Resource Accounting

Compact context projects retained information; evidence and completed work stay outside the model window. Requests cannot accumulate every reading or enumerate the corpus in tool schemas. Cross-dossier learning and institutional memory remain excluded.

| Context layer | Preservation and continuation |
| --- | --- |
| Required context | Automatically supply mission/scope, applicable human instructions and decisions, constraints, current versions, active work, open needs, the request causing suspension and its returned result. Explicitly identify changed instructions or versions. |
| Mission working memory | Retain examined avenues, open hypotheses, rejected interpretations with reasons, pending checks and intended investigations. Working notes remain distinct from established facts and human decisions. |
| Retrievable history | Automatically retain usable observable invocation inputs/outputs, operation requests/results, reading references and artifact versions, directly or by reproducible reference. Common scoped access also covers earlier turns of the dossier conversation. Earlier detail stays accessible when removed from the current window. |

Preserve context automatically through one shared assembly owner, with domain definitions supplying their context. Supply awaited results and continuation state directly, with scoped retrieval of earlier readings/exchanges. Notes never replace exact evidence. Required-context overflow blocks explicitly; instructions and unfinished work cannot be silently dropped. Reading windows, assembly and storage remain implementation choices. Accessible context does not prove correct model use. Exclude secrets/hidden reasoning; raw rejected-provider diagnostics follow their separate bounds and truncation rules.

Pi automatically compacts older working context with an LLM as its model window approaches capacity, reserving 8,192 tokens and keeping 8,192 recent tokens, with background compaction disabled. A proven non-dispatched 128 KiB request overflow also invokes native Pi compaction; an unknown dispatched outcome never does. Preserve current instructions, human decisions, obligations and required returned results separately from the lossy summary and inject that required state before every business generation. Summaries remain working aids, never evidence or authority. Exact originals stay in the Pi log and the application's scoped observable history; common `consult_conversation` access returns earlier processed analyst exchanges in bounded exact fragments and excludes queued instructions. FIFO admission tests required context, instructions and canonical tool schemas one message at a time and leaves the next oversized lot member queued. For a configured native route, admission and generation use a fixed-byte profile derived from the real SDK serializer plus the escaped required JSON. The profile is bound to the rendering, schemas, route and SDK versions; deterministic calibration checks ASCII, quotes, backslashes and Unicode, and a missing or mismatched profile blocks explicitly. Technical transcript snapshots obey the journal bound, while the complete native payload retains its separate exact model-input check before dispatch. Simulation uses its own complete serialized input and calibrated profile, normalizing only model-irrelevant clock metadata while retaining the exact original Pi log; its full input bound still triggers native Pi overflow compaction. Compaction cannot make oversized required state fit or silently omit it. Its calls share authorization, attempt policy, timeout, cumulative accounting and journal; deterministic fixtures verify mechanical reduction, retained originals, recovery and admission, not the semantic fidelity of a real provider's summary.

Persist confirmed results and obligations across external I/O; bounded model work is not an atomic database transaction. Compact continuation context includes agent and native results, plus referenced original instructions and their interpretation; exceeding capacity blocks explicitly. Exact history remains consultable without full conversation replay. The system schedules required follow-up checks automatically.

Automatically continue confirmed recoverable interruptions only under valid mandate, authority, versions, cancellation fences and remaining bounds. Reuse confirmed work; unknown outcomes permit no blind repetition. Public research resumption and internal mission recovery use the same recoverability classification. Retention of an admitted attempt's factual observation is separate from authority to adopt it: analyst pause suspends progression without permanently disqualifying that observation. Resume rechecks current authority, scope, instructions and versions before adoption, preserving revocation and cancellation fences. One shared attempt policy owns retries; Pi/SDK/Workflow automatic model retries stay disabled. Distinguish business refusal, analytical uncertainty and technical incidents. Recovery cannot cross human prerequisites or adopt revised judgments. Persist unfinished work when continuation is unavailable. Generation, lease, idempotency, telemetry and public-address safeguards still apply.

Count all provider calls cumulatively per dossier, including pre-launch framing, Workbench reasoning, research operations and controls; tool counts are insufficient. Authorize, bound and account framing work before dispatch even though it consumes no analysis reservation. Start research and continuation preserve that consumption. No per-agent quota or finalization reserve is selected. Hard ceilings may leave work incomplete. Set target-mission parameters before activation; [installed limits](#locked-resource-limits) still govern existing execution.

### Loop Prevention

Reuse confirmed results for unchanged inputs/versions when the domain permits. New invocations/generations do not create new logical operations. Repetition policy spans objectives, operations, parameters, examined versions and prior diagnostics. Domains define observable progress: new material, changed contributions or resolved obligations, not new identifiers/events/messages. Context-restoring rereading remains valid.

Mission requests retain cause/objective and obey [return bounds](#workflow-and-revision-contract). Initial inspection thresholds are binding; target-mission re-examination/non-progress thresholds still need values before activation. Cumulative ceilings also bound unrecognized semantic cycles. Once repetition without progress is confirmed, stop directly with an explanation and retained work, cause and obligations; do not grant an automatic extra strategy attempt. Compaction and new execution identifiers neither establish domain progress nor reset repetition or consumption. Later continuation requires an explicit request, authority, an admissible reason and remaining resources.

### Traceability and Typed Outcomes

Trace native and agent-requested operations, including rejections/blocks: actor, cause, inputs/references, versions and outcome. Correlate dossier, conversation messages, turn, mission, invocation, logical operation, provider attempts, controls and revisions. Reuse records the new caller’s cause while preserving the original logical identity. Domains retain artifacts; execution retains result references. Progress projects persisted work; deterministic actions create no provider receipts.

Extend the existing invocation and operation boundaries with one shared journal, following DeepSeek Harness's reconstructable-request principle without adopting its runtime or plugin system. Cover mission reasoning and one-shot qualification/comparison. Before dispatch, persist the model-visible request: rendered instructions, supplied context/messages, adapted tool/output schemas and effective generation settings. Retain original observable replies alongside normalized results and correlate existing provider and operation records.

Journal calls and operations, without incremental generation-fragment persistence. Persist operation requests before effects; commit received model output and its provider receipt together before business adoption. Capture complete tool argument text before SDK repair; retain raw and normalized values separately, and validate raw JSON without repair before operation admission. Preserve malformed argument text and its parse diagnostic; unavailable originals make the journal incomplete rather than a reconstructed reply. Receipts distinguish the requested model from any reported resolved model, effective upstream provider and provider-declared cost; SDK catalogue estimates are not reported charges. Pi required context references prior replies in the inspectable journal rather than copying them outside compactable history. A crash before result persistence leaves an explicit unknown outcome, never permission for automatic replay. Journal snapshots have their own [storage limit](#locked-resource-limits); model-input and operation limits remain unchanged. Missing or oversized content must be marked incomplete; a truncated diagnostic cannot represent a complete reply. Secrets and hidden reasoning remain excluded.

Provide an administrator-only, read-only timeline per dossier with paginated access to invocation, prompt, reply and tool-request/result details. Reuse existing administration and authorization boundaries. Analyst surfaces retain product-safe progress and errors. No external telemetry backend or general observability console is required.

Authorized attempts may receive terminal receipts after cancellation without result adoption, mission advancement, slot claims or new calls. Closure validates the exact admitted attempt; adoption separately checks current authority, versions and generation. Preserve path-specific guards when evolving receipts. External exactly-once execution is not promised; reuse confirmed results and adopt idempotently.

Typed outcomes distinguish controlled success, waiting, version conflict, missing configuration, resource/repetition stop, context-capacity block, technical interruption and unknown provider outcome. Analytical insufficiency/non-establishment remain domain conclusions. Isolate unknown effects; continue independent authorized work where possible. Translate analyst-facing outcomes under product copy rules; protected diagnostics retain boundary and cause.

## Implementation Transition

The following legacy contracts remain binding during transition. The roadmap distinguishes delivery from unfinished former requirements. Fixed dimensions, routine source approval and risk-triggered semantic checks are not target requirements. Existing authorization, membership checks, waits and limits remain until replacements have explicit semantics, compatibility and verification. Documentation cannot bypass controls or migrate data.

Extend existing records, Workflow, acquisition, retrieval, accounting and policy owners before adding concepts. Define framing, mandate, assertion/use, appraisal, review, synthesis and revision schemas per slice; current dimensions do not imply them. Preserve immutable evidence, decisions, receipts, unresolved outcomes and readable history. Legacy fixture regressions retain their scope; the roadmap owns migration sequence and delivery.

START now binds company confirmation, immutable optimistic-versioned framing edits and atomic explicit research start to one dossier and its analyst-facing thread. New framed launches retain the fixed questions and scope in initial and supplemental documentary planning; legacy dossiers retain their launch and checkpoint paths. The Workbench definition uses the shared Pi mission protocol for framing, saved-material consultation and controlled analyst instructions. Queued messages, promotion to steering, removal, response stop and queue continuation operate on retained deliveries; research runs independently. Framed documentary workflows drain admitted operations before applying an analyst pause and wait durably for Resume, which atomically reclaims the execution slot without replenishing deadlines or allowances. Pause controls are exposed only while the framed documentary continuation is implemented; later analytical stages do not inherit unsupported controls. The installed Sources preparation and explicit corpus-approval checkpoint remain in force; this slice does not introduce the target Sources agent or analytical mission bindings. The candidate Workbench route is configured but disabled until separately authorized qualification and activation.

Protocol acceptance covers native/tool authorization equivalence; interruption before dispatch, after confirmed effects and before agent return; context/obligation/counter continuity; conflicting requests and stale versions; late receipts without adoption; repetition/cross-mission bounds after restart; and refusal of incomplete artifacts/controls. Prove this with a deterministic operation and simulated model before integrating Sources through existing owners. Durable integration and semantic quality remain separate gates; specification grants no activation.

## Domain and Persistence

The table records legacy persistence contracts and compatibility invariants, not the final question-led schema or a delivery inventory.

| Records | Ownership and invariants |
| --- | --- |
| `Visitor`, `Invitation`, `Company`, `ResearchRun` | Stable admitted identity, compatible access-slot storage, canonical company identity and revision-aware execution. |
| `ResearchPlan`, `ResearchPlanQuestion` | Versioned plan and immutable questions, each with a stable key, bounded text, dimension, template version and creation provenance. Coverage is derived, not written back into questions. |
| `Source`, `CorpusRevision`, `SourceDecision` | Candidate provenance, immutable approved membership and append-only analyst choices. Multiple edits may share a draft. |
| `SourceSelectionProposal`, `SourceSelectionProposalItem` | Immutable recommendation snapshot, policy/input identity, disposition, reasons and pinned preparation. No analyst decision is created by generation. |
| `SourceCapture`, `SourceVersion`, `SourcePassage` | Immutable prepared content, approved analytical representation and exact reproducible quotations. Preparation does not confer analytical authority. |
| `Claim`, `ClaimEvidence`, `ClaimDimensionLink` | Atomic canonical proposal, sole claim-to-passage relation, and separate claim-revision-to-dimension proposal. No effective analyst decision or final confidence lives in a generated proposal. |
| `ClaimDecision`, `ClaimDimensionDecision`, `AssessmentDecision` | Append-only decisions on claims, links and atomic dimension outputs, including justified overrides. |
| `AssessmentDimension`, `ScoreProposal`, `Relationship`, `BriefRevision` | Dimension proposals and versioned derived outputs subject to the product's approved-evidence constraints. |
| `AITaskResult`, `PolicyEvaluation`, `ProviderCall` | Typed versioned inputs/results, deterministic gate rationale and actual external-attempt telemetry. |
| `WorkflowStep`, `CheckpointDecision`, `RunEvent`, `AuditEvent` | Durable execution/checkpoints, product progress, and separate security/access/quota history. |
| `EvidenceSourceStatus`, `ArtifactUploadLease` | Mutable execution projection and artifact-upload lifecycle; neither replaces immutable evidence. |

Validate persisted/external data at runtime with closed lifecycle values. Preserve corpus, source, claim, link, assessment, map and brief revisions without silent mutation. Introduce target concepts only for required observable behavior.

`SourceVersion` retains canonical URL, hash, media type, byte/page counts, retrieval/normalizer versions, metadata and normalized storage identity. Changed content creates a version; matching logical operation/hash reuses it. `SourcePassage` binds one version, exact quotation, normalized quotation hash, stable order and typed web/PDF locator. Unreproducible quotations are structurally invalid.

Only `ClaimEvidence` assigns `supporting`, `counter` or `context`; discovery, recommendation, family and company linkage confer no relationship. `ClaimDimensionLink` binds claim revision, dimension, extraction/corpus revision, `generated`/`analyst` origin, bounded rationale and any generating task. Every `Unknown` references an unresolved plan question and context passage. Protected, paginated, idempotent question backfills use persisted company identity, dimension keys and bounded angle without changing plans or inventing provider questions.

`EvidenceSourceStatus` binds frozen accepted source and generation, with `queued`, `running`, `succeeded`, `partial` or `failed`, bounded reasons and counts. Decisions transactionally maintain derived `sourceReviewItems` per source/revision; an idempotent admin backfill can rebuild it. Summaries use bounded indexed reads; collections, native cursor pagination. Approval checks effective decision heads, not historical accepted rows.

Workspace URLs use `section=progress|sources|investigation|synthesis`, validated mission-specific `subsection` and optional `inventory=1`. Legacy destinations map as follows: `evidence` → Inventory over Progress; `assessment` → Investigation/Review; `map` → Synthesis/Mechanism; `brief` → Synthesis/Full brief. Navigation grants no authority or capability and triggers no execution. Legacy lifecycle values cannot enable unavailable missions.

Inventory reuses authorized evidence queries and preserves matrix state after first opening. Dock opening adds history; closing returns to the previous entry. Closing a directly linked sheet removes only `inventory`. Source-review context survives overlays, refresh and history.

Under `section=sources`, validated `view` selects overview (absent), adjustment (`adjust`) or inspection (`inspect`). Canonical `coverage` keys apply only during inspection; all-candidate view removes that parameter, overview removes both. Refresh/direct links/history restore context without discovery, decisions or approval. Illustrative consumers retain local component navigation. Overview counts/membership and adjustment share one bounded decision projection.

Large artifacts use Convex File Storage. Upload leases progress through `reserved`, `uploaded`, `committed` or `orphaned`, attaching storage IDs when available. Upload/commit are non-atomic: require one committed referenced artifact per logical operation, allowing transient uploads. Failed finalization marks an orphan and attempts deletion. Protected paginated cleanup reconciles old leases/storage after a safety interval, covering pre-attachment crashes and protecting preparation captures and analytical versions.

## Legacy Workflow and Revision Contract

The installed path retains human source approval and fixture-gated evidence handoff. Planned dimension review and derived outputs were never certified and are superseded by the question-led target. Lifecycle values alone prove no implemented path.

```text
Existing path (claim generation is fixture-gated):
Explicit company selection → preflight confirmation → atomic analysis reservation
→ authoritative identity revalidation → public-evidence sufficiency review when needed
→ research plan → discovery → bounded capture/qualification/comparison
→ inspect alternatives and one finite supplement → source proposal → corpus approval
→ exact approved materialization → analytical claims → structural/policy validation
→ evidence_ready (arbitrary live inputs pause before claim generation)

Formerly planned continuation (not certified as delivered; superseded):
Counter-evidence within approved corpus → dimension review → derived views
→ finalization after all ten dimension decisions
```

| State family | Values |
| --- | --- |
| Research lifecycle | `draft`, `checking_public_evidence`, `awaiting_evidence_sufficiency_review`, `discovering_sources`, `awaiting_source_review`, `corpus_approved`, `extracting_evidence`, `evidence_ready`, `assessing_dimensions`, `awaiting_assessment_review`, `completed`. |
| Execution | `idle`, `running`, `paused`, `failed`, `cancelled`, `completed`. |
| Workflow step | `queued`, `running`, `completed`, `needs_review`, `failed`, `skipped`. |
| Completion outcome | `completed_assessment` or `insufficient_public_evidence`. |

Enforce transitions server-side. Execution status is separate from analytical lifecycle; failures/cancellation invent no stages. Pauses identify a source/assessment checkpoint or `claim_generation_unavailable`. Only persisted `RunEvent` records drive progress.

Preparation requires `SOURCE_QUALIFICATION_ENABLED=true`; disabled public starts reject. New workflows snapshot optional `prepareSources`; absence preserves discovery-to-review behavior. Legacy refresh is explicit, never render-triggered. Preparation may retain a separate handle beside the main workflow awaiting approval, on the same engine. Activation requires the roadmap's bounded model and protected-journey acceptance.

Drafts accept multiple additions/decisions. Approved membership changes require a new draft and approval. Reuse unchanged captures and exact-input qualifications without promising full incremental claim/brief recomputation. Draft proposals use the persisted run pointing at that revision, never stale snapshots.

Approval atomically verifies ownership, approved revision, generation and visitor capacity; freezes current accepted decision heads/IDs; claims the slot; advances generation; and starts analytical execution with a revision-bound idempotency key. Superseded accepted decisions confer no authority. Historical `corpus_approved + idle` and reopened corpora without waiting discovery workflows use the same protected execution owner. Emit extraction progress only after start; sources remain inspectable read-only during/after extraction.

Store active workflow IDs only while running; completion compare-and-clears its own handle. Retryable operations bind run, workflow version, generation, corpus revision, step and attempt. Running resumes atomically claim the visitor slot and advance generation. Check ownership, lease, generation and cancellation before I/O and persistence. Stale/duplicate/cancelled work cannot advance state or trigger paid attempts. Retries duplicate no evidence, reservations, call records or effects.

`evidence_ready + idle` requires terminal frozen source branches, a reproducible structurally valid passage, a terminal claim pipeline and a valid matrix-visible claim. Individual source failures or visible `needs_review`/`blocked` outcomes alone do not prevent handoff.

Without a claim adapter authorized for live passage hashes, pause at `extracting_evidence + paused + claim_generation_unavailable`, mark the claim step `needs_review` and release execution/slot. Fabricate no Unknown, success or assessment access. Owner/admin retry checks capability first; unavailability changes no state/generation, claims no slot and issues no call. Valid retry claims the slot, advances generation and starts a current-version workflow for incomplete claim/policy steps only. Cancellation requires explicit resume before retry.

## Source Preparation and Selection

These preparation/recovery contracts govern existing executions. Their pre-Investigation supplement is legacy compatibility, not the target complement. Reuse integrity/accounting without carrying forward obsolete progression or human stops.

### Captures and qualification

Before qualification, retain normalized content with source, requested/resolved URLs, retrieval time, representation, hash and retrieval/normalization versions. Pin captures and exact quotation/offset references on proposals. Approved reuse validates decision authority, hashes and locators. Missing/corrupt artifacts fail explicitly without substitute retrieval.

Retained captures, search candidates, model inputs and analytical passages are distinct. Passage limits do not delete captures; storage alone does not make omitted content reachable. Materialization preserves required qualification and applicable pinned-comparison primary references or fails. Shared source-use policy determines applicability; only revision-accepted sources qualify. Before reuse, verify quotations against captured bytes and persisted passages. Report incomplete historical materializations without rewriting them. Public PDF preparation uses Exa text and representation-relative locators, separately from page-aware parsing.

Qualification records purpose, company relationship, period, forecasts, attributed arguments, facts and outcomes with reproducible references. Authority is deterministic. Preserve restrictions; unavailable reading is not irrelevance. Contextual, opposing and restricted arguments confer no factual authority/corroboration. Unavailable required verification stays blocked or unknown.

Protocol 4 remains the default: one grouped call, at most fifteen findings, unchanged request/schema and grouped role contributions. Protocol 5 requires explicit evaluation selection; its live quality check retained material errors. It permits absent roles or at most two contributions per role. Each states assertion, analytical relevance, scope, kind, period, dependency and at most three exact inspected references. Prefer concrete architectural contributions over generic descriptions or role filling.

Distinct assertions may share mixed passages; classify the assertion while preserving the full quotation. Mixed/uncertain assertions retain restrictions, and ambiguous attributed hypotheses identify their intended contribution. Reading, claim creation and policy share one finding-use rule. New restrictions explicitly target the document, named roles, or inspected passages with named/all roles; justification references are separate. Scoped `no_substantive_content` withholds only conflicting contributions from coverage, documentary presence, comparison and factual use. Preserve independent contributions without automatic retry. Validate contribution basis and restriction scope at materialization/persistence.

Protocol-2 captures/approved pins stay readable. Resumed protocol-3/4 executions retain request/schema and comparison-policy identities; cached responses retain input identity. New captures pin input policy. Use all structured passages without indexing/search when they and the schema fit 128 KiB; otherwise use retrieved passages. Selection strategy enters input identity/provenance. Partial captures and historical policies, including unknown outcomes, remain unchanged.

New preparations/claimed recoveries snapshot `source_actions_v3`: one durable action per source inspects then qualifies through shared Node code. Captures/receipts persist independently; automatic action retries stay disabled. Reading/qualification may overlap across sources within snapshotted concurrency. Existing journals preserve step order and inline controls; absent snapshots preserve historical sequencing.

`collect_then_compare_v1` completes capture, qualification and permitted supplementation before comparison/publication. Inspect non-rejected alternatives before the single dossier-wide supplement; later primary content can then inform earlier contributions. Supplement planning shares classifier identity, period, purpose, authority and independence rules. Documentary presence is separate from use restrictions: pending comparison alone is no gap; rejected sources cannot satisfy presence.

Persist initial-reading completion with its progress event across supplementation/recovery. Review distinguishes that milestone, current work and proposal publication; later batches do not restart the initial stage. Explicit recovery opens another fifteen-minute window without resetting supplement/counters. Availability is `available`, `limited` or `not established`, with a reason.

Protected review preparation accepts current metadata-only drafts; staleness is not required. Its query reports start/resume availability without execution. Targeted searches share the supplement ledger and immutable search indexes with automatic searches, at most one per explicit request. Topic results remain visible independently of remaining allowance, including after the last search. Start/resume/targeting cannot add supplements, replenish calls or bypass atomic visitor slots. Missing configuration/exhausted allowances return typed blocks.

Before acquisition, read activation/model credentials from current invocation `process.env`, not generated module snapshots. Review combines pinned qualifications, committed captures and recent outcomes; targeted searches cannot replace dossier totals. Drafts expose completed qualifications immediately with the same capture/task/hash validation as published pins. Metadata, roles and uses share that qualification/classifier. Approved review uses immutable pins only; metadata-only review skips capture projections, and source details reuse validated qualification.

Status reflects unresolved non-rejected readings; interruption reasons include affecting operations and later additions. Missing configuration before acquisition means unprocessed; retained content without qualification means assessment unavailable. Query/mutation recovery eligibility is shared. Expiry fences its operation's I/O/persistence without blocking fresh explicit recovery. Targeted resumptions retain narrow scope; zero additions cannot trap unfinished original preparation in an empty scope.

Regulatory coverage searches use confirmed CIK and requested SEC form family; web searches use Exa. Each consumes one shared reservation, returns at most four candidates and respects the active deadline. Successful recovery clears only the searched family, even with no additions; partial/failure retains it. Later recovery addresses remaining failures without ledger reset.

This SEC path allows one attempt; transient HTTP/timeouts remain transport unavailability. Other callers keep their retry policy. Use public-address validation and pinned HTTPS with authorization before/after DNS and before persistence, bounded timeout/bytes, cancellation and no redirects. Initial/targeted discovery share identity/provenance mapping. Coverage distinguishes eligible/declared roles and document-type matches within a family; inclusion alone establishes no coverage.

Targeted additions retain their review operation and remain pending outside recommendations until analyst inclusion. They cannot displace existing recommendations through deduplication. Retrieval/qualification covers new IDs only. Comparison may reuse exact earlier pins for non-rejected sources under revision/execution fences, without reopening their retrieval/qualification or silently clearing earlier issues.

New manual sources get a new-content-only reading window, without reopening old work, resetting limits or adding supplements. Group links received while another dossier runs; start their window on slot claim. Explicit recovery opens a new window for that scope. Intake identity excludes generation; authenticated replay lookup precedes paused-state checks, preserving replay after automatic preparation starts. Reuse captures/qualifications only for matching inputs/versions. Preserve paragraph identities, offsets and omissions. When input is full, prioritize prose/tables/examples over navigation; formatting grants no factual authority.

### Targeted comparison

Compare eligible arguments/forecasts against relevant primary captures in the same run and active revision. Protocol-5 secondary factual premises/reported outcomes also require comparison. Search by assertion/scope, not unrelated quotation context. Older captures may support new manual content without requalification. Keep raw qualification/comparison separate; retain target/primary identities, hashes, spans, quotations, omissions and completeness.

Reuse before input reconstruction requires matching versioned instructions, schema, selection/retrieval policy, capture metadata and index state. Revalidate authority, references, hashes and quotations, then confirm context transactionally. Historical identities require exact-input revalidation before the derived checkpoint. Without eligible contributions, retain an idempotent local not-run result without retrieval/model work. Share immutable reads/validated reviews within one transaction only; distinguish approved pins from recent draft qualifications.

`No conflict observed` requires comparable primary references and covers only the stated contribution. Protocol 5 returns explained premise assessments with exact primary references; the application derives disposition. Possible conflict stays visible; unresolved premises mean inconclusive; only fully aligned premises permit no-conflict. Availability proves neither adoption, monetization nor superiority.

Conflict/inconclusive results restrict affected automatic arguments without asserting proven error. Match later issues by target capture/hash and overlapping span; positive output cannot silently clear them. Pin status/issue history into proposal fingerprints and approval. Missing/stale checks grant no new attributed-hypothesis permission; independent contributions retain permitted uses.

Reference aliases resolve only within exact prepared input; persisted results retain full identity. Every contribution may cite all primary passages in its grouped request; shortlists suggest relevance without limiting authority. Reject foreign/omitted keys and enforce citation bounds. Alias/input changes alter cache identity without rewriting history.

Versioned retrieval ranks covering quotations at their best contained-unit rank, then fills spare context. Soft expansion includes schema bytes and preserves priority context; hard passage/request limits still apply. Unversioned inputs keep previous selection. Explanations remain complete/non-empty within token/byte bounds, without editorial character limits or repair calls. Schema changes alter new input hashes; historical comparisons stay readable without migration.

### Scoped retrieval

New preparations may snapshot `structured-v1` with `lexical`/`hybrid` retrieval; absent configuration preserves historical behavior. Derived captures, passages and embedding caches remain preparation artifacts. Convex owns text search and a 1024-dimensional vector index. Search binds run, revision, capture hash and policy; caches bind exact text and opaque embedding-profile version.

Parsing overflow returns explicit unavailability before index writes. Apply eligibility before search limits and recheck on hydration. Lexical search uses capture-scoped hits and reciprocal-rank fusion. Actions prefetch at most two queries, each covering at most two captures and 64 hits per capture; consume bounded ordered results without retaining all combinations.

New preparations snapshot `stable-passages-v1`: fusion ties use captured URL, hash and passage position rather than row identity. Ranking enters request/comparison-context identity. Existing/resumed preparations retain recorded ranking, or historical policy without a snapshot; native scores/limits stay unchanged. Vector search prefilters run/revision/retrieval-version/profile/capture. Older scope keys explicitly degrade to lexical until reindexing relinks exact-text caches, without new models or embedding calls. Historical inputs remain unchanged.

Approved-source search shares the derived index under separate read authority. `ensureApprovedSourceIndex`/`searchApprovedSource` accept run/revision/source; the server resolves the approved capture. Check ownership/membership before storage, each batch and completion. Index identity binds run/revision/capture/hash/retrieval version. Publish completion after all batches; retries reuse rows. Reads require no active preparation or workflow resume and authorize no provider/model/embedding calls. Missing, corrupt, legacy-without-capture and incomplete-index outcomes stay explicit.

Source-details search is lexical/debounced: 512 characters, 16 terms, 64 results, with capture parsing/byte limits. Return source/capture/revision identity, content hash, retrieval time, exact quotation/hash and offsets. Results create no analytical passages/claims. Analyst copy exposes context, quotations and availability without internal IDs. Analytical limits remain 512 passages/source and 4,096/claim input. Materialization follows pinned extraction versions; unversioned qualifications preserve paragraph identities and required references within the same limit.

Workers AI is optional and direct. `SOURCE_RETRIEVAL_MODE` accepts `lexical`/`hybrid`; uncached embeddings require secure action-side `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN`. No local model, Worker deployment, Vectorize index, new subscription or persistence owner is required. Snapshot configuration into new preparations only.

Missing configuration/partial embeddings explicitly degrade to lexical with requested/effective modes and reason. Forbid truncation, redirects and automatic retries. Cumulative submitted-byte allowance uses one token per UTF-8 byte at the accepted price ceiling; unknown outcomes retain reservations. Historical evaluation allowances neither renew nor authorize activation.

### Deterministic proposals and legacy compatibility

Presets `balanced`, `first_party_depth` and `independent_scrutiny` adjust priorities/budgets only. Immutable proposals record active draft, policy version, candidate fingerprint, ceiling, disposition, rank and reasons. Optional versioned rationale distinguishes inspected contributions from metadata. Legacy items stay readable; authorized draft recomputation uses saved inputs without I/O or rewriting approvals. `recommended`, `needs_attention` and `alternative` are recommendations, not decisions. Add reliable distinct contributions without filling the ceiling.

Legacy linkage is `structural`, `discovery_metadata`, `unverified` or `not_evaluated`. Structural checks use confirmed CIK, official domain or approved decoded-path domain/full-name sequences, never query parameters, partial/generic names or ticker alone. Only declared institutional publishers/shared IR hosts may use discovery titles matching full normalized legal names or exact confirmed domain aliases of at least five characters. This supports recommendation only, never structural identity, kind, duplication, evidence or automatic coverage. Analyst/historical items use `not_evaluated` without invented proof.

Separate declared publisher capabilities from candidate-eligible roles. Non-structural metadata candidates have no eligible roles. Inspected content may establish relevance/purpose without promoting authority. Classify from authority-compatible decoded-path tokens, SEC form/accession, period/event identity and confirmed domain, never arbitrary substrings/titles. Institutional publishers retain independent/news roles; partners cannot fill first-party roles. Unverified company-matched counter-evidence remains inspectable alternatives. Reseller terms are corroborative, not canonical commercial terms.

Deduplication requires stable canonical/metadata-proven identity. Preserve analyst references; cover required roles, then distinct periods, events, producers or angle contributions. Metadata recommendations are separate from coverage; old items hydrate empty recommendation lists without reinterpretation. Version 13 preserves metadata-established identity/distinct utility when reading is unavailable/partial absent documented contrary findings. Retention grants no factual authority or content coverage; reasons cannot claim additional verified coverage. Preserve valid references, periodic novelty and multiple qualified ordinary roles per document. Independent-perspective roles require distinct producers.

Scoped caveats restrict explicit targets; legacy located caveats retain passage boundaries. Version 14 treats unknown-scope legacy `no_substantive_content` conservatively: withhold matching contributions when located, all when unlocated, with explicit scope uncertainty rather than inferred absence. Other unlocated caveats remain global. Approved policies/decisions stay immutable. Refreshing v10/v11/v12/v13 drafts applies current policy to saved candidates/qualification without discovery, calls, automatic requalification or rewritten decisions. Other migrations retain behavior.

Order by authority, provider order, recency, angle, then canonical URL before row identity. Recreating identical records cannot change recommendations. Analyst references precede and sit outside the discovered ceiling. Attention/coverage gaps do not block approval; an accepted source, fresh proposal, integrity and authorization are required.

Include/remove/undo append accepted/rejected/superseding-pending decisions. Group approval atomically checks ownership, generation, draft, policy, proposal version/fingerprint; preserves overrides; accepts pending recommendations individually; leaves others pending; records approval/audit and resumes execution. Candidate/policy changes stale drafts; older policies require explicit rebuild. Approved revisions remain immutable.

Rebuild serializes external work under a durable run/revision/generation/proposal/policy lease and checks the current pointer before dispatch/persistence. Return `complete`, `partial` or `blocked` with affected families. Partial results stay reviewable; blocks preserve drafts/decisions and permit fenced retry after persisted cooldown.

Current-policy recovery retries failed discovery families or searches one unconfirmed role. Bind stable request/target, preserve terminal replay, reject expired redispatch and fence approval, cancellation, supersession and lease expiry. Search remains metadata-only at the human checkpoint. Preserve failures until actual recovery resolves them. Coverage projects bounded effective inclusion/immutable eligibility without new decision authority.

## Acquisition, Validation and Providers

Acquisition safety and provider isolation span the transition. Accepted-decision authority and fixture-only analysis below describe installed paths; replacements follow the transition contract.

### Public URL intake and analytical materialization

One intake owner handles analyst URLs before/after launch, authorizing target and limits before DNS/HTTP. In the installed launch path, pre-launch inspection creates short-lived owned metadata receipts, not sources/evidence. Launch atomically consumes valid receipts with initial pending sources; invalid, missing, expired or foreign receipts create no run or quota use. Active-run intake rechecks revision/generation, then atomically creates source, pending decision, review projection and audit. Preserve these receipts and safeguards when separating target framing-dossier creation from Start research.

Canonicalize public HTTPS URLs. Reject credentials, unsupported ports/schemes and fragment-based identity; block private, loopback, link-local, reserved and metadata destinations. Validate every redirect and connect to that validated numeric address with original Host/TLS SNI. Bound content type, transfer, decompression and time. Retry timeout, connection, upstream rate-limit or unavailability once, never validation, authorization, duplicates, capacity, unsupported content or other client failures. Structured codes define retryability and safe presentation.

Materialization validates exact captured bytes and required pins under accepted-decision authority. Legacy unpinned approvals use SEC direct HTTP for confirmed CIK/accession, Exa Contents for general web. Web locators need anchored text/section; page-aware PDFs need page and bounding text. Reject unreproducible passages. Fan-out follows accepted-source count, not recommendation ceiling. Partial failures remain explicit without terminating independent branches.

The Unstructured page-aware normalizer and general live analytical adapters remain unfinished. Fixtures cannot appear live: deterministic claim/policy execution requires a full normalized-input match to the approved fixture manifest, records `showcase` provenance and creates no provider receipt. Other live inputs stop explicitly for unavailable capability.

### Typed analytical tasks and policy

Installed capabilities are source relevance, claim extraction, contradiction search, entailment, contradiction verification, dimension relevance, claim correction, dimension assessment and brief generation. Target missions extend existing routing/validation without adopting this dimension-based task list. Deterministic composition does not call source relevance. Qualification/comparison are separate preparation tasks with no inclusion or analyst authority.

Tasks have versioned application-owned input/output schemas. Generated results cannot grant approval, final confidence, quality or workflow permission. Non-overridable checks enforce schema, approved membership, provenance and locators. Versioned code policy combines observable evidence and separately recorded, selectively triggered verifier labels into reasoned `pass`, `needs_review` or `blocked` outcomes. Existing paths retain this policy; targets use mandatory submission controls and explicit reuse.

Persist normalized inputs, rules, verifier references and outcomes. Policy changes create evaluation revisions without rewriting history. Product rules govern assessments and justified overrides; structural failures remain non-overridable.

### Provider boundaries

The application router selects routes by capability, quality, cost, availability and failure. Required boundaries are OpenRouter and experimental Codex subscription access, with a future-provider extension contract. Use AI SDK's OpenRouter adapter for OpenRouter; its OpenAI-compatible adapter serves private CLIProxyAPI only. Never proxy OpenRouter through CLIProxyAPI or replace subscription access with API-key billing.

CLIProxyAPI uses an immutable upstream release/digest; the local fork is behavioral reference only. Begin with one instance/account unless measured need justifies expansion. Expose authenticated inference only; keep management/credentials private. Record version and available usage without invented subscription cost. This experimental transport is neither official OpenAI integration nor a permanent production commitment; production readiness is not a candidature gate.

SEC uses identifying direct HTTP with a shared aggregate limiter below its maximum. Exa discovery is metadata-only and omits `contents`. Separately authorized Exa Contents respects its 1,000,000-character and application byte bounds. Unstructured uses direct Pipeline Jobs HTTP, not legacy Partition.

Configuration owns primary/fallback routes, hard limits and retries. Provider-internal routing must preserve model, task semantics, authority and explicit privacy/parameter constraints. Persist logical operation/idempotency before I/O. Record every retry/fallback separately: capability, task/prompt/schema versions, exact input/output references, resolved route, attempt, latency, usage, reported cost when available and typed outcome.

Invalid structured output retains its exact parsing, schema, documentary-validation or termination reason separately from retry category. Receipt diagnostics retain rejected assistant output only: at most 64 KiB UTF-8, original size and explicit truncation. Admin summaries show the reason; full observable replies belong in protected [journal detail](#traceability-and-typed-outcomes). Analysts see neither. Historical failures without output remain undiagnosed. Exclude secrets/hidden reasoning. Missing configuration, disabled work and unavailability return explicit blocked/reviewable outcomes, never empty success.

Preparation disables automatic SDK/Workflow model retries and preserves structured-output/route-price ceilings. Attempt eligibility is:

| State | Allowed attempt policy |
| --- | --- |
| Never dispatched | Initial primary route plus one technical fallback. |
| Confirmed HTTP 408, 429, 500, 502, 503 or 504; received invalid model output | Each explicit recovery permits one additional attempt per operation/exact logical input, on the primary route without fallback. Further recoveries require remaining dossier allowances. |
| Unknown outcome: dispatched timeout, ambiguous disconnect, expired started receipt | No automatic or additional attempt. Generic historical transport errors stay unknown unless receipts prove otherwise. |
| Valid uncertainty, missing configuration, cancellation, disabled paid work or billing error | No fallback. Terminal failure remains distinct from recoverable and unknown outcomes. |

Persist at least fifteen seconds of cooldown, honoring longer valid Retry-After. Attempt identity excludes generation, request and route position; atomic reservations survive recovery. Preparation acquisition allows two initial attempts plus one admissible explicit recovery; other consumers/embeddings keep their policies. A failed supplement query permits one retry using an unconsumed reservation, within three cumulative calls.

Comparison shares preparation allowances, concurrency, telemetry and fences. `inline_controls_v2`/`source_actions_v3` journal inline controls; first batch lookup, comparison-target reads and final proposal remain scheduled. After three consecutive inline source-result saves, schedule the fourth to yield. Earlier journals preserve sequencing. Transaction/request bounds remain independent of fan-out. Check configuration before I/O and record failures on preparation, without fictitious provider calls.

Validate transport changes deterministically before authorized local trials. General acceptance requires fresh usefulness across companies/dossier types, not synthetic annotation of old output. Experiments alone select no runtime model and grant no activation. Deployment activation enables controls without starting drafts; the initial local trial uses structured lexical retrieval.

## Access, Resources and Security

### Admission and execution authority

Keep five stable slots, stored as `Invitation`: one admin, three human analysts (`analyst-1` through `analyst-3`) and local browser-validation `analyst-4`. The latter requires loopback deployment and `E2E_FIXTURES_ENABLED=true`. Anonymous Convex Auth uses reusable four-digit codes, stored only as HMAC-SHA-256 digests with server pepper. Atomically consume attempts before digest verification.

First admission creates a stable visitor. Reuse atomically rebinds it while preserving role, quota, dossiers and audit, revoking old Auth identity. Rotation revokes the session and later reactivates the same visitor; sign-out remains available. Never log plaintext codes.

Public Start/preflight permits anonymous Auth before admission. Dossiers, reservations, workflows and admin operations require active admission and role. Each visitor gets at most three lifetime analyses and one active research workflow; human research pauses free that slot. In the target path, Start research consumes one reservation; framing-dossier creation consumes none. Retries/resumes consume none, and abandoning launched research refunds none.

Research pause/resume primitives require `agentExecutionVersion: 3`; framed documentary continuations opt into these controls while retained legacy workflows keep their existing checkpoints. An effective pause advances research generation and releases its slot. Resume compares the expected generation; returning research to running atomically reclaims the slot and restores eligible missions without renewing consumption or deadlines. After documentary preparation has ended, Resume restores its required source-review checkpoint without claiming a running slot. Conversation generations and active-instruction versions are independent. Engaged results retain their original attempt generation; adoption requires current authority. A blocked conversational mission remains visible through the conversation follow-up projection.

One kernel policy derives authority from the admitted visitor, workspace, dossier, role, operation, phase and current versions for both native and agent callers. Framing permits bounded conversation and draft changes; active research permits its authorized progression and conversational follow-up; an analyst pause permits discussion of existing material and request registration without new research dispatch. Only research start/resumption claims the research execution slot. Backend identity, model arguments or client delivery mode cannot grant authority, and conversation cannot cross human decision prerequisites. The shared lifecycle schemas and framing/Workbench operations implement these boundaries. Workbench model qualification and activation, the complete target mandate and the three research mission bindings remain pending.

Capacity changes retain append-only rationale. Restoration returns unused reservations only. Admin withdrawal stops unfinished research through shared cancellation, releases exactly one consumed reservation, forbids later execution and preserves records/receipts/audit. Transactions enforce limits; UI state grants no authority.

Only server creation assigns `researchRuns.purpose`: `research`, `evaluation` or `browser_test`. Shared server authorization enforces workspace scope across dossier, source, evidence, decisions and actions; ownership alone grants no ordinary access to technical runs. Ordinary lists show non-withdrawn research only. Withdrawn dossiers remain directly readable/admin-inspectable; benchmarks and archived fixtures remain admin-only without ownership, quota, capture or audit changes.

Native pagination uses purpose/owner/context indexes. Client workspace keys reset pagination, never authority. Admin categories, unused reservations and per-run provider receipts paginate independently.

Browser fixtures require finite-lived private `browserTestContext`, bound to the reserved slot's current principal after real anonymous admission. Derive identity from the claimed invitation, never supplied identities. Only active contexts access their labelled dossiers; fresh admission needs explicit private rebinding. Teardown closes/fences/cancels through normal cancellation; scheduled expiry handles crashes. Historical contextless fixtures remain admin-only.

Test principals cannot initiate company resolution, manual acquisition or uncached rendering; browser runs cannot reserve provider calls. Cached artifacts and deterministic internal fixtures remain available. Global setup/teardown owns the local fixture flag.

Purpose migration widens schema, previews provenance classifications, backfills purpose only with append-only audits, verifies preservation, then requires the field. Private local preview/apply reject ambiguous fixture markers and never transfer owners or refund reservations.

Website enrichment is visual only. Use CIK cache, retain stale entries after refresh failure, then fall back to SEC IR metadata/company icon. Deduplicate by CIK, resolver version and cache window; check paid-work switch before SDK construction. Discard responses after timeout, cancellation, lease expiry or generation change. Failure neither invalidates SEC preflight nor consumes analysis quota. Record bounded accepted/rejected counts, latency and available usage without raw queries/errors.

Use configurable breadth, retry and provider guards, available provider spending controls and an emergency paid-work switch. Protected administration exposes operations, failures, calls, reported usage/cost and audited restoration. No transactional dollar settlement, invented free-tier accounting or exact dossier-cost enforcement is selected. Embedding bytes bound operations, not a financial ledger.

A versioned dossier summary tracks valid responses, confirmed incidents, unresolved reservations and dispatches atomically with receipts. Before dispatch, reserve both possible outcome allowances and dispatch capacity. Structurally/reference-valid responses consume productive capacity; confirmed dispatched failures, including invalid output, consume incident capacity. Neither proves semantic quality or zero cost.

Settle receipts once, releasing the unused outcome reservation. Proved non-dispatch releases both and dispatch capacity; unknown outcomes retain both and permit no repetition. Cached reuse/deterministic comparison revalidation consumes no model capacity. Review and dispatch share policy.

`SOURCE_PREPARATION_WORK_LIMIT` and `SOURCE_PREPARATION_INCIDENT_LIMIT` configure the defaults in the [limits table](#locked-resource-limits). Snapshot current invocation settings at explicit start; reject non-positive/unsafe integers or unsafe sums. Running execution retains its snapshot. Later explicit start/recovery may adopt new ceilings without resetting consumption; dispatch ceiling is their sum.

Initialize editable dossiers once before dispatch from bounded receipts and conservative maxima of legacy counters, without rewriting receipts/approved revisions. Reserve unexplained consumption or missing identity. Review interprets the same history without writing. Acquisition, supplement and embedding allowances remain separate.

### Locked resource limits

These installed limits remain binding during transition. They do not select target-mission parameters, which must include reasoning/control accounting before activation.

| Boundary | Accepted limit |
| --- | --- |
| Access attempts | 5 per anonymous Auth identity and 25 deployment-wide per 15 minutes. |
| Ranked company search | 40 candidates, locally paginated from one immutable result. |
| Website enrichment | 30-day cache; at most 5 metadata results; 3 displayed candidates plus selected company per search session; 12 calls per anonymous session and 25 deployment-wide per 15 minutes; one attempt, 5-second logical timeout. |
| Candidate scope | 48 initial candidates; one supplement of at most 3 searches, 4 additions each and 12 total; 60 retained/frozen sources for prepared dossiers, 48 for legacy acquisition. Never truncate an existing dossier during migration. |
| Discovered recommendations | Default `ceil(initial candidate limit / 2)`, currently 24; positive integer no greater than initial candidate limit; analyst references excluded from this ceiling. |
| Distinct contributions | 2 annual/interim periods, 3 material events, 4 per official family, 4 independent producers or 6 for independent scrutiny. |
| Acquisition and normalized artifacts | 16 MiB each, including declared/decompressed limits; at most 400 PDF pages and 5 redirects. |
| Analytical passages | 512 per source, quotations at most 4,000 characters; preserve all required pins or fail explicitly. |
| Source acquisition attempts | 2 initial; preparation alone permits one additional admissible explicit recovery attempt; SEC/direct HTTP 10-second abortable timeout; Exa Contents 120-second abortable outer timeout. |
| Qualification/comparison requests | 128 KiB full serialized input including instructions/context/schema; 6,144 output tokens; 60 seconds per model attempt. |
| Invocation journal | 512 KiB of UTF-8 JSON per request or reply snapshot, including its envelope. Model-input limits stay unchanged. |
| Pi persistence projection | 512 KiB per commit and 32 MiB retained log per mission; stop explicitly before exceeding replay capacity, without deleting or truncating originals. Replay pages read at most 16 commits / 2 MiB. |
| Preparation concurrency | Snapshot `SOURCE_PREPARATION_MAX_CONCURRENCY` at start/explicit recovery: default 2, positive safe integer, bounded by remaining sources. Reading/comparison share it; historical missing snapshots retain 2. The Workflow queue's global capacity is independent of dossier fan-out. |
| Preparation accounting | Default 120 valid responses and 40 confirmed incidents; unresolved calls reserve both allowances. Dispatch ceiling is their sum: 160 by default. Invalid configuration blocks execution before provider work. |
| Preparation execution | 15 minutes per explicitly claimed execution; manual content and targeted operations retain narrow scope. |
| Preparation route ceiling | USD 0.15 per million input tokens and USD 0.60 per million output tokens. These are accepted limits, not a claim about current market prices. |
| Comparison retrieval | 60 metadata candidates, 8 primary captures, 16 MiB per capture and 32 MiB aggregate reads; 6 priority passages plus up to 2 structural context passages per finding. |
| Shared comparison context | 32 KiB soft serialized expansion allowance; hard 64 passages/128 KiB; at most 8 output citations per finding; complete non-empty explanations within 6,144 output tokens and 700 KiB materialized output. |
| Structured parsing | 100,000 blocks and 20,000 searchable units per capture. |
| Native retrieval | 64 lexical hits per capture/query transaction, fused to 64 per research query; vector top 256 after capture scope filtering. |
| Embeddings | At most 32 inputs per request, 2 active attempts per dossier, 30 seconds, 1 MiB response, no retry/redirect/truncation. |
| Embedding allowance | 833,333 cumulative submitted UTF-8 bytes per dossier, conservatively USD 0.01 at the accepted USD 0.012/million-token ceiling; unknown outcomes retain allowance. The historical frozen evaluation ceiling was USD 0.10 and is not renewed. |

Check capacity before inspection/discovery and transactionally at persistence; stop further calls once exhausted. Resource changes require explicit decision and contract/evaluation updates.

### External I/O and transient preview

Authorize protected operations and leases/generations before DNS, SDK or HTTP; revalidate before persistence. Enforce least privilege, server-only secrets, safe logs, sanitization and bounded parsing/decompression. Source text/model output is untrusted evidence, never instructions. Defend against prompt injection and SSRF, including redirects/DNS rebinding.

Visual preview uses a separate Playwright service through authorized Convex actions only. Authenticated `POST /render` creates a fresh context without prior cookies/storage/credentials/downloads, returns only 1280×720 PNG and always tears down. Return no HTML, scraped text or OCR. Log hostname, duration, status/error type, never full URLs, content or screenshots.

Cache reads/rendering require active owned run access, visitor-bound claimed invitation and pending source decision. Check before I/O, after response and atomically before caching. Cache by source with bounded bytes and server TTL, default one hour. Expired entries are absent; oversized images may return uncached. Accept/reject purges preview; cache hits never render. Limit attempts to two per visitor/run/source per 30 seconds. Screenshots never enter evidence/analysis paths.

Chromium uses a per-render authenticated loopback CONNECT proxy to validated numeric public addresses, preserving end-to-end TLS. Pause redirects and validate destinations/subresources within five hops. Block service workers, WebSockets, downloads and non-GET requests. Bound context lifetime, queue/concurrency, connections and aggregate transfer. Service/backend private-address and redirect policies must stay equivalent; local fixes prove no remote deployment.
