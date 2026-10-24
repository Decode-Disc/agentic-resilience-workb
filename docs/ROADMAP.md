# Prototype Roadmap

## Purpose

This living checklist sequences the smallest coherent vertical slices needed to build the Agentic Resilience Evidence Workbench prototype.

This document owns delivery state and sequence. [PRODUCT.md](../PRODUCT.md) owns product requirements and acceptance, [context/TECH.md](../context/TECH.md) owns technical contracts, and [AGENTS.md](../AGENTS.md) owns working and verification rules. A checked item records delivery within its stated verification boundary; it does not imply activation, remote deployment or completion of the entire phase.

## Current Delivery State

The phases follow the current [source-preparation contract](../context/TECH.md#source-preparation-and-selection); [ADR-024](decisions/024-qualify-source-content-before-corpus-approval.md) and [ADR-025](decisions/025-use-versioned-scoped-evidence-retrieval.md) retain the rationale. The outcomes below distinguish implementation, local verification and live acceptance. No completed live invitation-to-brief journey is certified.

| Capability | Recorded delivery | Remaining boundary |
| --- | --- | --- |
| Company resolution, discovery and corpus review | Implemented; [live retrieval and protected review checks](verification/2026-10-20-source-recovery-contract-repairs.md) are recorded. | Historical checks cover the tested slice, not every future source. |
| Capture, qualification and targeted comparison | Immutable preparation artifacts, complete comparison explanations and local activation are implemented. [Grouped provider experiments](verification/2026-10-21-source-quality-second-batch.md) retain schema and semantic failures. | Useful fresh preparation remains unaccepted. |
| Structured lexical and optional hosted-embedding retrieval | Implemented, with [retention replay and interpretation corrections](verification/2026-10-21-evidence-retrieval-repair.md). The next local trial uses lexical retrieval. | Neither a definitive retrieval winner nor dynamic-source robustness is established. |
| Source review and decisions | Local checks cover phase-specific progress, reactive coverage and source readings, explicit partial outcomes, targeted search, saved selection reasons, legacy-draft recomputation and preparation recovery after expiry. Protected desktop/mobile fixtures cover live updates, reconnection and retained readings, decisions and cumulative limits. | Fixture checks and inspection of an interrupted dossier do not establish fresh usefulness or user visual acceptance. |
| Corpus approval and saved-source search | Exact capture materialization, required-reference handoff and search beyond initial passage selection have protected desktop/mobile coverage. Earlier [source-review checks](verification/2026-10-22-source-review-corrections.md) remain dated evidence. | General live analytical retrieval is not established; the remote preview-service correction remains undeployed. |
| Claims and Evidence Matrix | The hash-gated deterministic showcase path is implemented; [Phase 5 verification](verification/2026-08-15-phase-5-evidence-matrix-provenance.md) records its scope. | Arbitrary live dossiers pause before claim generation. Real analytical generation and verification remain unfinished. |
| Administration | Checkpoint and provider histories use bounded reads and have local protected checks. | Run and visitor lists still use complete reads; the remaining operations surface belongs to Phase 8. |
| Dimension review, map and brief | Required later slices. | No completed analytical review or final derived-output journey is certified. |

### Next Preparation Gate

Local preparation was activated on 2026-10-23. The first analyst-launched dossier saved two captures from 48 sources, then stopped before qualification; its subsequent annual-report search also failed before provider I/O. Configuration, regulatory-search routing, recovery and review-state corrections were verified locally without rerunning that dossier or renewing its elapsed preparation window. An analyst-triggered recovery on 2026-10-24 subsequently reached qualification and comparison and returned a partial proposal for review. This processing progress does not establish analytical usefulness.

Bounded explicit recovery in the same editable dossier is implemented and locally verified, including protected desktop/mobile fixtures, preserved readings and decisions, and unchanged cumulative allowances. Local verification does not replay the real dossier. The next smallest slice is analyst review of its retained material and limitations, followed by the protected approval and capture handoff. A fresh analyst-launched dossier must still verify the new-run path and live usefulness. Inspect useful retained material, visible omissions, exact provenance and the protected handoff within the existing allowance. Further checks must cover different companies and dossier needs before any general quality claim. The historical 32 retrieval conditions are not a completion target, and no additional paid benchmark is required before this trial.

### Open Verification Limits

- Protected local journeys exercise decisions, approval, capture reuse, history, keyboard access and reconnection. Controlled fixtures and read-only inspection of the interrupted dossier do not certify fresh provider behavior, general analytical quality or visual acceptance.
- External image availability and CORS behavior remain unqualified after earlier failures. The separate approval-only performance gate remains unaccepted after a materialization wait and a favicon-abort mismatch.
- Some grouped tests timed out and passed in focused reruns without increased timeouts; those results do not establish a cause for the grouped instability. The recorded slices do not certify a passing aggregate check; earlier lint/format failures and unrun full-suite checks remain part of the record.

Detailed historical verification notes, including local-only evidence locations, remain recoverable at `bd07b1bf756d8538547477a700c15aeb6391675d:docs/ROADMAP.md`. The linked reports and raw artifacts are unchanged.

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
- [x] Implement explicit recovery after expiry, confirmed transient failures and received invalid outputs, with conservative historical compatibility and cumulative attempt/search limits. Deterministic checks and protected local desktop/mobile fixtures cover recovery; provider-backed recovery remains unqualified.
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
- [x] Reuse captured normalized text for prepared sources. Page-aware PDF normalization remains a deterministic fixture contract until real Unstructured is integrated in Phase 8.
- [x] Create stable, reproducible source passages and locators.
- [x] Extract typed atomic `Fact`, `Inference`, `Hypothesis`, and `Unknown` claim proposals through a hash-gated deterministic showcase adapter.
- [x] Apply non-overridable structural validation and versioned deterministic policy evaluation.
- [x] Trigger typed semantic verification only when deterministic rules require it.
- [x] Link each canonical material claim to exact passages and separately decided dimension links.
- [x] Preserve supporting evidence, counter-evidence, and critical unknowns.
- [x] Exclude rejected sources from every downstream artifact.
- [x] End successful Phase 5 work at the `evidence_ready + idle` handoff.
- [x] Preserve arbitrary live retrieval provenance but pause honestly at `claim_generation_unavailable` without fabricated claims or Phase 6 unlock.

Note: [Phase 5 deterministic/local certification](verification/2026-08-15-phase-5-evidence-matrix-provenance.md) and [real SEC/Exa retrieval checks](verification/2026-10-20-source-recovery-contract-repairs.md) are dated evidence. Earlier failures remain recorded. Real Unstructured, general live claim generation and semantic-verifier integration remain Phase 8 work. Preparation already has separate real model adapters and bounded experiments. Later analytical stages are not yet an available recovery mechanism for every preparation omission.

- [x] Verify the local handoff for useful content beyond the initial selection: qualification and applicable comparison references reach analytical input with exact provenance; approved saved-source search retrieves a previously unselected passage through the protected desktop/mobile interface and after reconnection. The 512-passage limit is unchanged. These checks use labelled fixtures and do not complete general live claim generation.
- [x] Correct source-retention regressions across multiple companies and version the reviewed retrieval references to accept explicitly adjudicated equivalent passages. Historical raw scores remain unchanged; neither retrieval mode is declared a general winner.

## Phase 6 — Dimension Assessment and Human Review

Outcome: analysts can inspect and revise evidence-backed proposals across all ten dimensions.

- [ ] Propose separate position, confidence, and three-year direction outputs.
- [ ] Derive confidence from inspectable evidence characteristics.
- [ ] Present exception-driven grouped claim review while persisting individual append-only decisions.
- [ ] Unlock dimension review when its claims and dimension links have decisions.
- [ ] Record one atomic assessment decision per dimension with justified field overrides.
- [ ] Support AI-assisted cited replacement claims without mutating original proposals.
- [ ] Preserve proposals, analyst decisions, overrides, and revision history append-only.
- [ ] Verify weak-evidence outcomes without forcing certainty or an aggregate score.

## Phase 7 — Derived Analyst Outputs

Outcome: validated evidence produces useful secondary views without introducing unsupported assertions.

- [ ] Build a progressively updated evidence-backed architecture map with uncertainty and coverage cues.
- [ ] Require validated supporting claims for every map relationship.
- [ ] Incrementally compose a draft brief from analyst-approved claims only.
- [ ] Preserve brief revisions and their evidence inputs.
- [ ] Show the persisted map and brief contribution after each dimension decision.
- [ ] Keep incomplete coverage explicit until all ten dimensions are decided.
- [ ] Add the methodology and limitations surface.

## Phase 8 — Real Providers and Operational Guards

Outcome: the deterministic workflow can use real services safely through provider-independent boundaries.

- [x] Implement the bounded OpenRouter preparation adapters, configuration-owned qualification/comparison routes, output validation, application-owned fallback and telemetry under ADR-024.
- [ ] Complete capability-based routing for remaining analytical tasks and the approved Codex subscription transport.
- [ ] Add the real Unstructured Pipeline Jobs HTTP adapter for page-aware PDF normalization.
- [ ] Integrate real model-provider claim generation, semantic verification, and fallback routing.
- [ ] Keep retries and explicit fallback application-controlled and fully audited.
- [ ] Validate structured provider output before it becomes usable evidence.
- [ ] Record best-effort usage, latency, status, retries, and reported cost.
- [ ] Enforce configurable breadth limits, bounded retries, and the paid-work emergency switch.
- [ ] Add the minimal admin operations surface for runs, checkpoints, provider calls, quota restoration, and paid-work shutdown.
- [ ] Verify partial failures and late results cannot corrupt or advance cancelled runs.

Source acquisition now belongs to pre-approval preparation for new prepared dossiers, with post-approval retrieval retained for legacy corpora. Phase 8 completes real analytical model integration, page-aware PDF normalization and the remaining operational guards. Existing preparation adapters and experiments do not establish acceptance of those future tasks. The unchecked cross-cutting items above concern the remaining analytical workflow, even where preparation already implements equivalent safeguards.

## Phase 9 — CCC Showcase and Evaluation

Outcome: one carefully curated dossier demonstrates original, contested, and measurable analytical judgment.

- [ ] Freeze the CCC source cutoff date and bounded workflow scope.
- [ ] Curate and approve a corpus with suitable independent evidence.
- [ ] Define expected claims, known contradictions, and deliberate unknowns after manual review.
- [ ] Resolve open evaluation questions: extraction and locator quality, whether the bounded CCC corpus discriminates the competing interpretations, and the minimum evidence questions needed per dimension.
- [ ] Reuse the curated CCC dossier as the first regression corpus instead of creating a parallel golden dossier.
- [ ] Add small deterministic fixtures for isolated policy rules.
- [ ] Include at least one material, justified analyst override.
- [ ] Evaluate citation validity, entailment, classification, contradiction retrieval, and unsupported-claim rate.
- [ ] Record duration, available provider usage or cost, and analyst corrections.
- [ ] Label the completed dossier and all fixtures as curated or precomputed.
- [ ] Allow the curated Phase 5 dossier to demonstrate the read-only Evidence Matrix while keeping showcase labelling in Phase 9.
- [ ] Evaluate source preparation across several companies, source families and dossier types, separately from the curated showcase. Include broad research, targeted questions, supplied references and uncertain arguments without requiring multiple completed showcase dossiers.
- [ ] Distinguish exact-reference retention, useful equivalent evidence, displayed qualification and downstream answer quality. Report corpus reuse, reference authorship, known controls and unverified transfer explicitly.

### Demonstration Checkpoint B — Completed Showcase

- [ ] The evidence matrix makes provenance, counter-evidence, and uncertainty immediately legible.
- [ ] The assessment demonstrates technical-economic judgment rather than vendor-message synthesis.
- [ ] The architecture map and brief contain no unsupported material.
- [ ] Infrastructure remains secondary to the analyst value demonstrated.

## Phase 10 — End-to-End Demo Readiness

Outcome: the complete invitation-to-brief journey is reliable, honest, and ready for the candidature demonstration.

- [ ] Verify the full invited-analyst journey against [MVP acceptance](../PRODUCT.md#mvp-acceptance).
- [ ] Run focused, affected, full, type, lint, format, and critical browser checks.
- [ ] Verify responsive, keyboard-accessible, and non-color-dependent critical screens.
- [ ] Exercise empty, loading, partial-failure, needs-review, cancelled, and insufficient-evidence states.
- [ ] Rehearse the separate live-run and curated-showcase paths.
- [ ] Publish only measured methodology, limitations, duration, and provider usage.
- [ ] Document remaining risks, deployment constraints, and known gaps before recording the demo.

## MVP Completion Gate

- [ ] Record evidence against every criterion in [MVP acceptance](../PRODUCT.md#mvp-acceptance), with incomplete gates and remaining risks explicit. No completed invitation-to-brief journey is certified by the present roadmap.
