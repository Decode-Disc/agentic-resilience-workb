# Prototype Roadmap

## Purpose

This living checklist sequences the smallest coherent vertical slices needed to build the Agentic Resilience Workbench prototype.

This document owns delivery state and sequence. [PRODUCT.md](../PRODUCT.md) owns product requirements and acceptance, [context/TECH.md](../context/TECH.md) owns technical contracts, and [AGENTS.md](../AGENTS.md) owns working and verification rules. A checked item records delivery within its stated verification boundary; it does not imply activation, remote deployment or completion of the entire phase.

## Current Delivery State

The accepted [question-led conception](brainstorming/question-led-workbench/2026-10-23-question-led-workbench-conception.md), its three mission designs and shared execution architecture are promoted into the product and technical references. This is a design baseline, not implementation evidence. Phases 0–5 retain the installed corpus-approval and dimension-based delivery record; phases 6–10 sequence the transition and remaining target. [ADR-024](decisions/024-qualify-source-content-before-corpus-approval.md) and [ADR-025](decisions/025-use-versioned-scoped-evidence-retrieval.md) preserve earlier rationale. No completed live end-to-end analytical journey is certified.

| Capability | Recorded delivery | Remaining boundary |
| --- | --- | --- |
| Company resolution, discovery and corpus review | Implemented; [live retrieval and protected review checks](verification/2026-10-20-source-recovery-contract-repairs.md) are recorded. | Historical checks cover the tested slice, not every future source. |
| Capture, qualification and targeted comparison | Immutable artifacts, comparison after supplementation, whole-document qualification, bounded read prefetch and journaled inline preparation controls are implemented. Reading/comparison concurrency is configurable per dossier execution (default two), independently of the global Workflow queue. [Concurrency verification](verification/2026-10-25-preparation-concurrency.md) isolates cached coordination gains. The [live concurrency trial](verification/2026-10-25-preparation-concurrency-live.md) observes little reading gain and faster comparison; passage-selection drift prevents clean attribution. [Work-reduction verification](verification/2026-10-25-source-preparation-work-reduction.md) covers deterministic ordering, protected review and retained real captures. [Live before/after timing](verification/2026-10-25-source-preparation-live-comparison.md) observes 5 min 24 s versus 9 min 16 s at concurrency two. | One company, a changed source collection and unresolved SEC reading failures do not establish general performance or analytical usefulness. |
| Structured lexical and optional hosted-embedding retrieval | Implemented, with [retention replay and interpretation corrections](verification/2026-10-21-evidence-retrieval-repair.md). The next local trial uses lexical retrieval. | Neither a definitive retrieval winner nor dynamic-source robustness is established. |
| Source qualification consistency | Scoped restrictions isolate conflicting contributions from coverage and factual use while retaining independent contributions and the source. Stable captured-passage fusion ties, bounded rejection diagnostics, legacy execution compatibility and protected desktop/mobile review after reconnection are locally verified. An explicit-assertion and material-premise candidate is executable in the evaluation bench. | The [live candidate check](../scripts/evaluations/source-selection/SOURCES-APPROACH-EVALUATION-20261025.md#assertion-candidate-implementation-and-live-recheck) improves several contributions but retains missed material factual premises and incorrect source-purpose/comparison judgments. The candidate is not the application default; general analytical acceptance remains open. |
| Source review and decisions | Local checks cover phase-specific progress, reactive coverage and source readings, explicit partial outcomes, targeted search, saved selection reasons, legacy-draft recomputation and preparation recovery after expiry. Protected desktop/mobile fixtures cover live updates, reconnection and retained readings, decisions and cumulative limits. | Fixture checks and inspection of an interrupted dossier do not establish fresh usefulness or user visual acceptance. |
| Corpus approval and saved-source search | Exact capture materialization, required-reference handoff and search beyond initial passage selection have protected desktop/mobile coverage. Earlier [source-review checks](verification/2026-10-22-source-review-corrections.md) remain dated evidence. | General live analytical retrieval is not established; the remote preview-service correction remains undeployed. |
| Claims and Evidence Matrix | The hash-gated deterministic showcase path is implemented; [Phase 5 verification](verification/2026-08-15-phase-5-evidence-matrix-provenance.md) records its scope. | Arbitrary live dossiers pause before claim generation. Real analytical generation and verification remain unfinished. |
| Administration | Purpose-scoped dossier lists and technical inspection use native pagination; benchmarks and historical browser fixtures are isolated from human workspaces. Local purpose migration preserves all 407 dossiers and their existing business fields. Deterministic checks cover authorization, private browser contexts, provider blocking and research-only quota restoration. | Protected local desktop/mobile journeys verify isolated validation data, administrator pagination and read-only inspection, context closure, and explicit rebinding after real readmission. The [migration and verification record](verification/2026-10-26-research-workspace-isolation.md) records the passing global tests and the pre-existing import-lint limitation. The visitor inventory remains bounded by the five stable access slots; remaining administrative operations and guards are tracked under end-to-end demo readiness. |
| Design-system transfer and workspace shell | Theme tokens, shared controls, four-section navigation and the in-context inventory sheet are implemented. Legacy destinations and source-review controls are retained; component tests cover URL compatibility and inventory state. | Protected local desktop/mobile journeys verify inventory history, focus restoration, retained source context and reactive source decisions. Logout and real readmission recover the persisted dossier. Investigation, Synthesis and the post-launch composer still require their executable capabilities. |
| Reusable question-led UI library | Twenty presentation components, shared Button/Badge integration, restored company favicons and an isolated light/dark gallery are implemented. The gallery supports visual inspection, including the chat framing composer and explicit turn composition; focused checks cover inventory interactions, keyboard/focus, scrolling and reader pagination. | START and shared conversation primitives now have a production consumer. The gallery remains illustrative; question-led investigation, persisted appraisals and live synthesis are not connected. |
| Shared agent execution and worktree runtime | New missions use Pi Durable for generation/tool continuation, retained technical history and compaction, with fenced Convex persistence/scheduling and the existing domain operation, authorization and accounting owners. Retained Workflow missions and one-shot qualification/comparison remain compatible. See the [replacement verification](verification/2026-10-30-pi-durable-replacement.md). [Native review corrections](verification/2026-11-01-native-workbench-continuity.md#native-review-corrections) cover retained-result adoption, coherent message/tool admission and controlled publication with strict writer leases; protected local desktop/mobile continuity passes. [Synthetic performance measurements](verification/2026-11-01-native-workbench-continuity.md#performance-investigation-after-independent-review) support grouped capture validation and fewer replay RPCs; deployed-backend latency remains unmeasured. Local services retain distinct worktree identities and fixed ports. | Administrative model defaults and dossier choices are implemented; live Workbench remains feature-gated. Simulated replies and mocked HTTP establish mechanics, not summary fidelity, model judgment or three-mission acceptance. |
| Shared invocation journal | Bounded request/reply snapshots, atomic receipt/result settlement and an administrator dossier timeline are implemented and [locally verified](verification/2026-10-27-shared-agent-harness.md#central-invocation-journal). | No live-provider certification; historical snapshots remain unavailable. |
| Question-led framing and three-mission execution | Accepted [Workbench conversation and framing contracts](../context/TECH.md#workbench-conversation-steering-and-instructions), including persistent dossier identity, queued/steering turns and tracked instructions. | START binds versioned framing, atomic explicit research start and queue/steering controls to real Convex records. The [integrated local qualification](verification/2026-11-01-workbench-integrated-nemo-qualification.md) exercises real protected admission, local Convex, paid Nemo and publication. Eighteen calls across three code stages expose and then verify malformed-argument refusal and control-only framing-write guards; final controls preserve the exact revision and session after mobile reconnection. Earlier preservation, analyst-edit precedence and waiting documentary-registration checks remain retained. The [GLM browser lot](verification/2026-11-01-workbench-glm-browser-qualification.md) completes eleven responses with useful scoped framing and recovery, while internal-jargon and verbose-hypothesis gaps remain; the recalled elaboration is a wording ambiguity rather than a confirmed authority failure. Broader economic usefulness and deployed-browser inference remain unqualified. Previous local timeouts do not reproduce under the current host/backend, but their historical cause remains unisolated. The route stays disabled; delegated selection and the three research-agent bindings remain unfinished. |
| Investigation, grouped appraisal review and Synthesis | Required target slices, replacing planned fixed-dimension review and secondary map/brief generation. | No completed common inquiry, retained-appraisal handoff or joint diagram-and-note journey is certified. |

### Next Preparation Gate

This remaining acceptance gate concerns the installed preparation path under the [transition contract](../context/TECH.md#implementation-transition). It preserves its unresolved evidence without making a further paid trial a prerequisite to documenting or starting the target transition in Phase 6.

Local preparation was activated on 2026-10-23. The first analyst-launched dossier saved two captures from 48 sources, then stopped before qualification; its subsequent annual-report search also failed before provider I/O. Configuration, regulatory-search routing, recovery and review-state corrections were verified locally without rerunning that dossier or renewing its elapsed preparation window. An analyst-triggered recovery on 2026-10-24 subsequently reached qualification and comparison and returned a partial proposal for review. This processing progress does not establish analytical usefulness.

Bounded explicit recovery in the same editable dossier is implemented and locally verified, including protected desktop/mobile fixtures, preserved readings and decisions, and unchanged cumulative allowances. Local verification does not replay the real dossier. Within that path, remaining acceptance concerns analyst review of retained material and limitations, followed by the protected approval and capture handoff. An authorized [live comparison](verification/2026-10-25-source-preparation-live-comparison.md) observes a revised preparation reaching review in 5 min 24 s against 9 min 16 s, with 24 rather than 25 qualified sources and the same five unavailable SEC documents. This establishes one elapsed-time observation, not analytical usefulness or general performance. Inspect useful retained material, visible omissions, exact provenance and the protected handoff within the existing allowance. Further checks must cover different companies and dossier needs before any general quality claim. The historical 32 retrieval conditions are not a completion target, and no additional paid benchmark is required before this trial.

### Open Verification Limits

- Analytical control and question-outcome architecture is accepted in [ADR-026](decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md) and specified in [TECH](../context/TECH.md#analytical-control-and-question-outcome-contracts), but its Investigation and Synthesis operations, projection and semantic evaluation remain unimplemented. The shared runtime's delivery does not establish their quality. Phases 8 and 9 record these priorities.
- Question coverage still counts linked evidence, including `Unknown`. Replacing that projection is blocking debt for answer labels and transitions requiring an answer under the [product contract](../PRODUCT.md#evidence-matrix-and-analytical-review); the current evidence-presence metric cannot authorize them.
- The prior harness review findings were repaired at the recorded checkpoint. A five-lane independent review of the Pi replacement requested corrections to admission, native observations, recovery and storage behavior; the replacement record tracks those corrections and their verification. The [replacement record](verification/2026-10-30-pi-durable-replacement.md) owns current local checks and runtime changes; earlier aggregate/import failures and the isolated reservation timeout remain in the [harness verification](verification/2026-10-27-shared-agent-harness.md).
- Protected local journeys exercise decisions, approval, capture reuse, history, keyboard access and reconnection. Controlled fixtures and read-only inspection of the interrupted dossier do not certify fresh provider behavior, general analytical quality or visual acceptance.
- External image availability and CORS behavior remain unqualified after earlier failures. The separate approval-only performance gate remains unaccepted after a materialization wait and a favicon-abort mismatch.

Detailed historical verification notes, including local-only evidence locations, remain recoverable at `bd07b1bf756d8538547477a700c15aeb6391675d:docs/ROADMAP.md`. The linked reports and raw artifacts are unchanged.

The records in phases 0–5 describe installed behavior and its remaining verification limits. Checked legacy checkpoints and dimension-related contracts do not become target requirements; keep their safeguards until a verified replacement.

## Phase 0 — Application Foundation

Outcome: a runnable, testable application foundation ready for product work.

- [x] Initialize TanStack Start, React, TypeScript, and pnpm.
- [x] Connect the Convex development foundation.
- [x] Apply the selected shadcn preset and institutional shell baseline.
- [x] Configure Biome, Vitest, type checking, and CI quality checks.
- [x] Document the product, technical, and decision boundaries.

## Phase 1 — Domain and Persistence Backbone

Outcome: the minimum typed, persisted model needed to express real product state.

- [x] Define the first required domain schemas and runtime validators.
- [x] Enforce research-run and workflow-step lifecycle transitions server-side.
- [x] Persist append-only run events and audit events in Convex.
- [x] Verify valid transitions, invalid transitions, and audit preservation.

## Phase 2 — Private Access and Quotas

Outcome: only visitors with a configured access code can reserve analyses within the prototype limits.

- [x] Seed exactly five stable access slots through an idempotent setup path.
- [x] Implement server-side visitor admission, session rebinding, and authorization.
- [x] Reserve at most three analyses per admitted visitor atomically.
- [x] Verify concurrency, persistence across sessions, and audited quota restoration.

## Phase 3 — Durable Workflow Skeleton

Outcome: a deterministic research run can progress, pause, resume, fail, retry, and cancel durably.

- [x] Implement the provider-independent Convex Workflow skeleton.
- [x] Make persisted `RunEvent` records the only source of UI progress.
- [x] Add the durable source-approval and analyst-review checkpoints.
- [x] Verify resumption, bounded retries, cancellation, and idempotency with deterministic adapters.

## Phase 4 — Company Discovery and Corpus Preparation

Outcome: an analyst can review a useful proposed source set backed by inspected content, visible limitations and exact capture provenance, then approve the corpus. Preparation need not settle every analytical question.

- [x] Preflight-resolve, confirm, reserve, and authoritatively revalidate a supported US-listed technology company.
- [x] Pause on insufficient public evidence with HTTPS URL addition, explicit completion, or justified force-continuation paths.
- [x] Build and persist a company-specific research plan with one of the approved source-coverage presets.
- [x] Discover and rank proposed SEC and web sources with visible, persisted progress.
- [x] Implement bounded capture, normalization, qualification and targeted comparison before approval under preparation authority; inspect existing alternatives before one finite supplement.
- [x] Preserve exact captures, qualification references, restricted uses, unavailable-reading outcomes and analyst-supplied references without granting factual authority.
- [x] Expose native preparation for current metadata-only drafts and preserve its start/resume result in source review. Implement the retained Coverage, carousel and shared reader composition, full-collection candidate search, pending-only preview and explicit search feedback. Targeted prepared searches share the cumulative supplement allowance, keep new candidates pending, and reuse older pinned readings for comparisons without reopening collection. Deterministic regression checks cover these contracts; runtime activation and fresh live acceptance remain separate gates below.
- [x] Implement structured retrieval and optional hosted embeddings within the accepted resource limits, with explicit lexical degradation and no local embedding model.
- [x] Approve a versioned corpus containing accepted sources while preserving rejected and pending candidates.
- [x] Persist corpus approval and atomically hand accepted sources to the Phase 5 workflow. Preserve the protected start path for historical idle approved dossiers.
- [x] Enforce one running workflow per visitor and prevent analytical source versions, analytical passages and claims before explicit corpus-revision approval.
- [x] Activate preparation on the existing local backend for an analyst-triggered trial, with structured lexical retrieval, the selected inexpensive routes and complete bounded comparison explanations. Preserve the existing draft and approval workflow without triggering paid work during activation.
- [x] Correct invocation-time preparation configuration, regulatory targeted searches, retained progress and review status semantics after the first interrupted analyst trial. Publish locally without rerunning the real dossier, resetting its deadline or making paid calls.
- [x] Implement repeated explicit recovery after expiry, confirmed transient failures and received invalid outputs, with separate configurable productive/incident allowances, conservative historical accounting and unchanged cumulative search limits. Deterministic checks and protected local desktop/mobile fixtures cover recovery; provider-backed recovery remains unqualified.
- [ ] Establish the remaining preparation acceptance evidence using useful source content, visible omissions and protected handoff, without requiring exhaustive answers or perfect source selection.
- [ ] Evaluate fresh qualification/comparison inputs and outputs across different companies and dossier types during authorized real use before claiming general preparation acceptance. Historical model responses and exact-reference scores alone do not satisfy this gate.
- [ ] Verify fresh prepared runs and legacy drafts through the protected journey, including reconnection, desktop/mobile review, keyboard/focus behavior, cancellation and exact approved capture reuse. Existing illustrative checks and the read-only inspection of the interrupted real dossier do not establish fresh live preparation. The next full trial remains an explicit analyst action on a new dossier.

### Demonstration Checkpoint A — Honest Live Run

- [x] Start a genuinely new company run.
- [x] Show confirmed company resolution, source discovery, and persisted progress.
- [x] Stop at the explicit corpus-approval checkpoint.
- [x] Confirm that no cached or precomputed work is presented as live.

These historical discovery checks do not certify activation of the subsequently added content-preparation workflow.

## Phase 5 — Evidence Matrix and Provenance

Outcome: approved sources become inspectable, precisely cited evidence rather than an unsupported narrative.

- [x] Materialize the exact inspected captures selected by corpus approval, validating stored content and pinned references; missing or corrupt captures fail explicitly without silent replacement retrieval.
- [x] Retain real SEC and Exa Contents retrieval for legacy approved sources without preparation captures, with visible partial failures.
- [x] Reuse captured normalized text for prepared sources. Page-aware PDF normalization remains a deterministic fixture contract until the real Unstructured adapter is integrated.
- [x] Create stable, reproducible source passages and locators.
- [x] Extract typed atomic `Fact`, `Inference`, `Hypothesis`, and `Unknown` claim proposals through a hash-gated deterministic showcase adapter.
- [x] Apply non-overridable structural validation and versioned deterministic policy evaluation.
- [x] Trigger typed semantic verification only when deterministic rules require it.
- [x] Link each canonical material claim to exact passages and separately decided dimension links.
- [x] Preserve supporting evidence, counter-evidence, and critical unknowns.
- [x] Exclude rejected sources from every downstream artifact.
- [x] End successful Phase 5 work at the `evidence_ready + idle` handoff.
- [x] Preserve arbitrary live retrieval provenance but pause honestly at `claim_generation_unavailable` without fabricated claims or access to legacy dimension assessment.

Note: [Phase 5 deterministic/local certification](verification/2026-08-15-phase-5-evidence-matrix-provenance.md) and [real SEC/Exa retrieval checks](verification/2026-10-20-source-recovery-contract-repairs.md) are dated evidence. Earlier failures remain recorded. Real Unstructured, general live claim generation and semantic-verifier integration remain unfinished delivery work. Preparation already has separate real model adapters and bounded experiments. Later analytical stages are not yet an available recovery mechanism for every preparation omission.

- [x] Verify the local handoff for useful content beyond the initial selection: qualification and applicable comparison references reach analytical input with exact provenance; approved saved-source search retrieves a previously unselected passage through the protected desktop/mobile interface and after reconnection. The 512-passage limit is unchanged. These checks use labelled fixtures and do not complete general live claim generation.
- [x] Correct source-retention regressions across multiple companies and version the reviewed retrieval references to accept explicitly adjudicated equivalent passages. Historical raw scores remain unchanged; neither retrieval mode is declared a general winner.

## Phase 6 — Framing and Controlled Transition

Outcome: the analyst can frame one persistent dossier, launch the question-led workflow and orient it through Workbench without weakening dossier authority.

- [ ] Define concrete framing, mandate and business instruction records, common research questions, case-specific needs and contextual-intervention thresholds within the accepted scope.
- [ ] Specify compatibility for current dossiers, approved corpora, claims, dimension decisions and in-flight executions before replacing any installed checkpoint or schema.
- [x] Create the persistent framing dossier after admission and company confirmation, preserving its identity, optional angle, public references and analyst-facing conversation through research and results.
- [x] Connect conversational refinements and direct controls to the same versioned framing draft, with optional contextual clarification and transactional stale-write rejection.
- [x] Bind framing edit authority to the original message baseline and require an explicit native documentary target. The [final paid cases](verification/2026-11-01-workbench-message-authority-requalification.md) preserve newer analyst content and record a supported waiting request without resume.
- [x] Enforce supported explicit whole-program preservation commands and publish factual receipts for known failed framing edits; verify native continuation and the protected local browser path in the [explicit-guard qualification](verification/2026-11-01-workbench-explicit-guards-qualification.md).
- [x] Exercise the protected local browser-to-Nemo path; repair malformed-argument dialogue interruption and control-only framing-write authority, then verify exact revision preservation and real charge reconciliation in the [integrated qualification](verification/2026-11-01-workbench-integrated-nemo-qualification.md).
- [x] Add typed `/pause` and `/resume` commands with button-owned controls, idempotent factual receipts and passive native history synchronization; commands create no model generation.
- [x] Connect the composer slash menu to the typed command API and simple per-dossier model selector; preserve free text, queue/steering and explicit research start. The 2026-11-02 revision retains the original composer layout and materials, adds Pasta UI model/effort controls and native assistant-ui suggestions, and pins persisted reasoning effort for subsequent responses; see the [verification increment](verification/2026-11-01-native-workbench-continuity.md#composer-composition-native-slash-and-effective-effort).
- [x] Add administrator-managed model preparation, availability and per-agent assignments, with immutable per-response/mission routing and installed-SDK capacity profiles. Sources qualification/comparison consume their assignment; Investigation and Synthesis remain explicitly unconnected.
- [x] Qualify protected desktop/mobile composer and model administration, including reconnection, zero-generation slash controls and native continuity; see the [verification increment](verification/2026-11-01-native-workbench-continuity.md#composer-commands-and-administrable-models). Compatibility preparation and simulated replies do not qualify model usefulness.
- [ ] Qualify broader semantic compliance and useful company framing with the intended stronger model. Preserve the unresolved cause of earlier local timeouts; current non-reproduction and native publication do not establish deployed reliability or activation readiness.
- [x] Persist explicit Start research as the atomic, idempotent framing commitment, analysis consumption and Sources launch; bound and account prior framing without starting documentary preparation or question investigation.
- [x] Apply common operation/phase authority so Workbench can converse during framing and analyst pauses without falsely marking research active or bypassing human prerequisites.
- [x] Implement Workbench turns with default queued messages and explicit active-turn steering, preserving useful work and checking active-instruction freshness before dispatch and adoption.
- [x] Track analyst instructions through the existing operation owners, retaining original messages, interpreted needs and explicit outcomes under the available research phase.
- [x] Connect shared research pause/resume primitives to the framed documentary workflow and analyst controls, preserving engaged results, pending requests, cumulative consumption and the single active research slot.
- [ ] Make the proposed company/activity scope and intended question useful immediately without reconstructing activity revenue or introducing financial calculations.
- [ ] Evolve the existing workspace within the accepted timeline, compact composer and contextual-intervention direction. Settle remaining layout choices before changing the affected surfaces.

## Phase 7 — Shared Execution and Sources

Outcome: one controlled execution mechanism supports adaptive documentary inquiry and preserves useful work across interruptions.

Typed definitions now share the Pi execution loop, canonical native/tool operations and independent conversational/research authority. Convex retains business state, leases, scheduling, adoption, budgets and publication. Historical Workflow drivers and adapters stay registered for retained missions; no retained execution is migrated implicitly. Capacity-aware turn selection, paginated earlier-conversation access, bounded operation draining/rebinding and native automatic compaction are implemented. Workbench is bound to START and the retained Sources preparation. New Workbench conversations pin definition version 2 and reuse one native Pi conversation across bounded response missions; historical conversations keep version 1 and their existing journals. The [2026-11-01 continuity verification](verification/2026-11-01-native-workbench-continuity.md) covers projected tools, deterministic control confirmations, native steering, handover/recovery and capacity limits. Sources, Investigation and Synthesis agent bindings remain implementation work. The [replacement evidence](verification/2026-10-30-pi-durable-replacement.md) distinguishes deterministic and protected local checks from provider-backed quality acceptance.

- [x] Implement the common mission/continuation protocol on the existing Workflow engine, with static agent definitions, temporary invocations, retained operation requests/results and shared native/tool dispatch.
- [x] Isolate generation behind a shared backend contract; verify both real library adapters, versioned selection, retained observations and controlled recovery without activating a live reasoning route.
- [x] Preserve Convex Agent versions 1 and 2 and historical AI SDK adapters for pinned Workflow executions; new missions now pin Pi Durable runtime version 1 with native Pi transport and fenced Convex technical storage.
- [x] Implement shared conversation/research authority, queued and steering turns, deferred operation continuation and bounded mission returns, with deterministic component/Workflow coverage and a protected local conversational journey.
- [x] Synchronize the shared backend and exercise conversational administration on desktop/mobile after reconnection with simulated provider I/O.
- [x] Repair the three execution findings: preserve confirmed model replies across analyst pauses, resume recoverable interruptions through public Resume, and retain active instructions across history pages with transactional rejection of assembled-context overflow. The Pi continuation delivery below replaces the earlier fixed queue/response bounds for new missions.
- [x] Replace new agent execution machinery with Pi Durable, including independently bounded queue draining/rebinding, capacity-aware message selection, common access to earlier processed conversation turns and automatic compaction with required state outside the summary. Preserve cumulative accounting, explicit non-progress stops, confirmed-result reuse and unknown-outcome blocking; retain historical execution paths. See the [technical contract](../context/TECH.md#shared-execution-structure).
- [x] Implement and deterministically verify [native Workbench continuity and the shared model interface](../context/TECH.md#accepted-native-conversation-and-model-interface) for new conversations: one Pi conversation across response missions, native admitted messages, snapshot-derived tool arguments, definition-owned completions, control confirmations and explicit journal exhaustion. Retain historical conversation behavior and require separate live quality qualification.
- [ ] Establish model-backed summary fidelity and useful live mission output in an explicitly authorized bounded evaluation before enabling a live agent route. The [2026-11-02 GLM qualification](verification/2026-11-02-workbench-summary-fidelity-qualification.md) preserves critical distinctions in controlled histories after actual native compaction. Targeted correction-stage lots distinguish analyst adoption from evidence, unstarted research from pause, and conversational hypotheses from saved framing. The final lot also recovers original messages to verify historical authorship. Minor quotation and approval wording, the earlier unknown-cost evaluator failure, natural long-history fidelity and the deployed compression path remain explicit; broader mission-output acceptance stays open.
- [ ] Implement the shared access and Sources operations needed by this slice through existing domain owners, callable by authorized native code and mission-specific agent bindings under equivalent rules. Add the Investigation and Synthesis operations in their respective phases when their behavior is needed.
- [x] Assemble required continuation context, retained working memory and retrievable observable history; verify automatic preservation, explicit capacity blocks and on-demand reading without corpus-sized tool schemas.
- [ ] Support targeted artifact changes, resulting-artifact controls, precise diagnostics and system execution of known required dependent checks.
- [ ] Define current mission artifacts, progression checks, unfinished obligations and cumulative accounting for all reasoning, operation and verifier provider calls. Set bounded execution parameters before activation without resetting previous consumption.
- [x] Preserve confirmed work and cumulative repetition controls during authorized recovery of the initial saved-material mission; fence cancellation, conflicting requests, stale versions and unknown provider outcomes without crossing human prerequisites. Verify factual late receipt recording independently from business adoption.
- [x] Reuse the implemented bounded OpenRouter preparation adapters, exact captures, scoped retrieval, provider receipts, source-use policy and resource protections rather than duplicating them.
- [ ] Give Sources adaptive documentary inquiry, authorized observed-link acquisition, qualification submission and targeted documentary checking under system-organized preparation.
- [ ] Integrate mandatory targeted semantic controls at qualification submission, explicit unchanged-control reuse and precise contribution/use restrictions. Preserve useful independent contributions.
- [ ] Implement delegated source selection under the agreed mandate and typed exceptions. Keep the later Investigation-driven complement available instead of spending it on initial role coverage.
- [ ] Complete the provider routing, output validation and operational guards needed by this slice; retain the existing preparation acceptance limitations until fresh bounded evaluation resolves them.

## Phase 8 — Investigation and Grouped Appraisal Review

Outcome: a common inquiry produces reasoned appraisals with inspectable evidence, objections and unknowns for meaningful human judgment.

- [ ] Implement the accepted appraisal-submission operation and typed semantic findings under [TECH's analytical control contract](../context/TECH.md#analytical-control-and-question-outcome-contracts), keeping deterministic admission and disposition separate from technical execution.
- [ ] Add the materialized Investigation-owned question-outcome projection before enabling answer labels or dependent transitions; retain evidence presence separately and verify `Unknown`-only evidence, substantive proposed and retained answers, justified insufficiency, required revision and technical incompleteness.
- [ ] Enrich one reusable company inventory through controlled assertions and separate question-specific uses; admit each contribution before use without routine human confirmation of every assertion/link.
- [ ] Preserve exact evidence, permitted use, attribution, temporal scope, corrections and earlier judgments. Distinguish evidence presence from an answered question.
- [ ] Conduct one common inquiry across questions and compare rival interpretations. Group decisive missing information into at most one bounded autonomous documentary complement, then re-examine the returned material without another search cycle.
- [ ] Submit an appraisal or justified insufficiency for every assigned question, controlling the reasoning from assertions and assumptions through mechanisms to economic consequences.
- [ ] Keep sourced figures and ratios with definitions and limitations; produce no new financial calculations or dedicated financial collection.
- [ ] Implement grouped review with identifiable appraisal versions, per-question correction or deferral, and append-only decisions. An empty retained set stays at review and cannot start Synthesis.
- [ ] Handle material exceptions contextually while independent work continues; preserve source inspection, matrix access and decisions after reconnection.
- [ ] Evaluate admission and appraisal semantics separately from documentary preparation, including incorrect use, competing interpretations, decisive unknowns and revisions of retained judgments.

## Phase 9 — Synthesis, CCC Showcase and Evaluation

Outcome: retained appraisals support an immediately useful economic interpretation, with its diagram and fully reasoned note controlled together.

- [ ] Implement the accepted joint diagram/note and alternative-finding control operation under [TECH's analytical control contract](../context/TECH.md#analytical-control-and-question-outcome-contracts), with typed findings and deterministic initial disposition.
- [ ] Produce a reference economic mechanism diagram anchored in the investigated actors and workflow, with traceable relationships, conditions and uncertainty; derive the note from the same interpretation.
- [ ] Control new transversal inferences and joint diagram-to-note fidelity. Retaining the inputs cannot automatically validate a proposed relationship.
- [ ] Route a necessary uninstructed premise or appraisal concern through bounded Investigation re-examination of available material, without another documentary phase.
- [ ] Preserve targeted human review of material changes to retained appraisals. Deliver a limited joint result only from a coherent unaffected base; wait when the overall interpretation depends on a contested premise.
- [ ] Submit justified non-establishment when an instructed retained base supports no mechanism, distinguishing it from no retained appraisal, pending judgment and technical interruption. Do not add a routine final approval stop.
- [ ] Freeze the CCC source cutoff and photo-led auto physical damage scope; curate the evidence, expected assertions, competing interpretations, known contradictions and deliberate unknowns. Examine whether that bounded material discriminates between the interpretations without predetermining the conclusion.
- [ ] Reuse the curated CCC dossier as the first regression corpus, with small deterministic fixtures for isolated rules and at least one material justified analyst correction or override.
- [ ] Evaluate citation validity, entailment, classification, contradiction retrieval, appraisal reasoning, unsupported assertions and diagram-note coherence. Record duration, available usage/cost and analyst corrections.
- [ ] Evaluate source preparation across companies, source families and dossier needs separately from the curated showcase. Distinguish exact-reference retention, useful equivalent evidence, qualification and downstream analytical quality; record reuse, authorship, known controls and unverified transfer.
- [ ] Label curated, precomputed and fixture results explicitly and provide methodology with measured limitations.

### Demonstration Checkpoint B — Completed Showcase

- [ ] A decisive economic question and its scoped interpretation are immediately useful to Raphaëlle and her analysts.
- [ ] Appraisals expose the shared evidence, objections and unknowns, with identifiable retained human judgments.
- [ ] The mechanism diagram and note express the same supported interpretation, or the alternative finding explains non-establishment honestly.
- [ ] Provenance remains inspectable while infrastructure and routine coordination remain secondary.

## Phase 10 — End-to-End Demo Readiness

Outcome: the complete question-led journey is reliable, honest and ready for the candidature demonstration.

- [ ] Complete remaining capability-based analytical routing, semantic verification and application-controlled fallback, including the approved experimental Codex subscription transport and real Unstructured Pipeline Jobs adapter. Their current unfinished status cannot be presented as live delivery.
- [ ] Verify all exposed I/O authorization, validation, idempotency, bounded retry, telemetry, cancellation and late-result protections for the new mission paths.
- [ ] Complete and verify protected administrative inspection, audited quota restoration, audited dossier withdrawal releasing its analysis and the emergency switch for new paid work; preserve existing purpose-scoped workspace isolation.
- [ ] Verify the full admitted-analyst journey against [MVP acceptance](../PRODUCT.md#mvp-acceptance), including Start research, grouped review, synthesis outcomes and preserved state after reconnection.
- [ ] Run applicable focused checks and the CI aggregate at final readiness, with protected desktop/mobile, keyboard/focus, non-color cues and relevant reduced-motion checks.
- [ ] Exercise empty, loading, partial, unfinished-check, pending-judgment, cancelled and insufficient-evidence states, including limited synthesis and waiting on a central contested premise.
- [ ] Rehearse genuinely live and clearly curated paths; publish only measured methodology, limitations, duration and provider usage.
- [ ] Record remaining risks, deployment constraints and incomplete gates before recording the demonstration.

## MVP Completion Gate

- [ ] Record evidence against every criterion in [MVP acceptance](../PRODUCT.md#mvp-acceptance), with incomplete gates and remaining risks explicit. The accepted conception and reference update alone certify no completed end-to-end journey.
